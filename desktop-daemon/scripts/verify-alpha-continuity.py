"""Targeted synthetic Alpha acceptance: real HTTP/SQLite, headless UI, no installed app.

Requires the existing Python Playwright package and an installed Chromium.
Build the static frontend with NEXT_PUBLIC_BRAIN_URL=http://127.0.0.1:39123 first.
The runner owns its listeners, isolated browser profile, token and synthetic DB.
It never contacts a paid provider or launches/interacts with the user's client.
"""
import argparse
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import queue
import secrets
import socket
import subprocess
import threading
import time
import urllib.request
from urllib.parse import urlparse
from contextlib import ExitStack


BRAIN_PORT = 39123
# Cold TypeScript/SQLite startup is intentionally bounded, but Windows hosts
# can be heavily loaded by unrelated desktop processes.  Keep the limit
# finite while allowing the owned fixture to finish its deterministic module
# graph load instead of turning scheduler contention into a false product
# failure.
BACKEND_START_TIMEOUT_SECONDS = 90

from playwright.sync_api import sync_playwright, expect


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument(
        "--browser-executable",
        type=Path,
        help="Use an already-installed Chromium-compatible browser without downloading one.",
    )
    args = parser.parse_args()
    if args.browser_executable and not args.browser_executable.is_file():
        parser.error(f"Browser executable does not exist: {args.browser_executable}")
    root = Path(__file__).resolve().parents[2]
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=False)
    (evidence / ".synthetic-alpha-fixture").touch()
    token = secrets.token_urlsafe(32)
    ui = None
    brain = None
    model = None
    # Do not forward the caller's provider credentials, npm configuration, or
    # arbitrary NODE_OPTIONS into the synthetic server. The fixture needs only
    # normal Windows process variables and its own loopback-only settings.
    env = {key: os.environ[key] for key in ("PATH", "SYSTEMROOT", "WINDIR") if key in os.environ}
    env.update({
        "TEMP": str(evidence),
        "TMP": str(evidence),
        # Keep Node/tsx/esbuild user caches inside the owned fixture directory;
        # an absent Windows profile can otherwise fall back to the system
        # profile and make cold startup nondeterministically exceed the bound.
        "USERPROFILE": str(evidence),
        "HOME": str(evidence),
        "APPDATA": str(evidence),
        "LOCALAPPDATA": str(evidence),
        "NODE_ENV": "test",
        # NEXT_PUBLIC_BRAIN_URL is embedded in the prebuilt static UI, so this
        # controlled runtime must own that exact loopback port.
        "PORT": str(BRAIN_PORT),
        "OMNI_FIXTURE_LLM_PORT": "0",
        "OMNI_DESKTOP_IMPORT_FIXTURE": "1",
        "LOCAL_API_TOKEN": token,
        "OMNI_ALPHA_FIXTURE_ROOT": str(evidence),
    })
    # CREATE_NO_WINDOW keeps the synthetic service invisible. Lowering process
    # priority can starve Node/SQLite startup on Windows and prevent READY; the
    # isolated fixture is short-lived and loopback-only, so keep normal priority.
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    backend = None
    server = None
    browser = None
    context = None
    page = None
    checks = []
    external = []
    errors = []
    http_failures = []
    expected_fault_injections = []
    backend_start_attempts = 0
    backend_diagnostics = []
    actions = 0

    def sha256_directory(directory):
        if not directory.is_dir():
            return None
        digest = hashlib.sha256()
        for path in sorted(item for item in directory.rglob("*") if item.is_file()):
            digest.update(path.relative_to(directory).as_posix().encode("utf-8"))
            with path.open("rb") as source:
                for block in iter(functools.partial(source.read, 1024 * 1024), b""):
                    digest.update(block)
        return digest.hexdigest()

    def git_metadata():
        try:
            head = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=root, check=True,
                capture_output=True, text=True, timeout=10,
            ).stdout.strip()
            branch = subprocess.run(
                ["git", "branch", "--show-current"], cwd=root, check=True,
                capture_output=True, text=True, timeout=10,
            ).stdout.strip()
            status = subprocess.run(
                ["git", "status", "--porcelain=v1", "--untracked-files=all"], cwd=root,
                check=True, capture_output=True, text=True, timeout=10,
            ).stdout
            diff = subprocess.run(
                ["git", "diff", "--binary", "HEAD"], cwd=root, check=True,
                capture_output=True, timeout=20,
            ).stdout
            untracked = subprocess.run(
                ["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=root,
                check=True, capture_output=True, timeout=10,
            ).stdout.split(b"\0")
            diff_digest = hashlib.sha256(diff)
            for raw_path in sorted(path for path in untracked if path):
                source_path = root / os.fsdecode(raw_path)
                if source_path.is_file():
                    diff_digest.update(b"\0UNTRACKED\0")
                    diff_digest.update(raw_path)
                    with source_path.open("rb") as source:
                        for block in iter(functools.partial(source.read, 1024 * 1024), b""):
                            diff_digest.update(block)
            return {
                "git_head": head,
                "git_branch": branch,
                "source_worktree_clean": not bool(status.strip()),
                "source_worktree_diff_sha256": diff_digest.hexdigest(),
                "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            }
        except (OSError, subprocess.SubprocessError):
            return {
                "git_head": None, "git_branch": None,
                "source_worktree_clean": False, "source_worktree_diff_sha256": None,
                "runner_sha256": None,
            }

    def check(name, assertion=True, details=None):
        if not assertion:
            failure = {"name": name, "status": "FAIL"}
            if details is not None:
                failure["details"] = details
            checks.append(failure)
            raise AssertionError(json.dumps(failure, ensure_ascii=False))
        checks.append({"name": name, "status": "PASS"})
        print("PASS " + name, flush=True)

    def api(route, body=None):
        request = urllib.request.Request(brain + route,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    def start_backend():
        nonlocal brain, model, backend_start_attempts, backend_diagnostics
        last_error = None
        # Node/SQLite cold start can be starved intermittently on Windows. A
        # bounded retry makes the controlled harness deterministic while still
        # failing closed if the owned fixture cannot publish READY twice.
        for _attempt in range(1, 3):
            backend_start_attempts += 1
            process = subprocess.Popen(["node", "--import", "tsx", "tests/fixtures/alpha-continuity-server.ts"],
                cwd=root / "brain-server", env=env, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                encoding="utf-8", creationflags=flags)
            ready = queue.Queue()
            threading.Thread(target=lambda: ready.put(process.stdout.readline().strip()), daemon=True).start()
            stderr_lines = []
            def collect_stderr():
                for line in process.stderr:
                    line = line.strip()
                    if line:
                        stderr_lines.append(line[-1000:])
                        del stderr_lines[:-40]
            threading.Thread(target=collect_stderr, daemon=True).start()
            try:
                deadline = time.monotonic() + BACKEND_START_TIMEOUT_SECONDS
                while True:
                    if process.poll() is not None:
                        raise RuntimeError(
                            f"Synthetic Brain exited before readiness (exit code {process.returncode})"
                        )
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise RuntimeError(
                            f"Synthetic Brain did not become ready within {BACKEND_START_TIMEOUT_SECONDS} seconds"
                        )
                    try:
                        message = ready.get(timeout=min(0.25, remaining))
                        break
                    except queue.Empty:
                        continue
                parts = message.split()
                if len(parts) != 3 or parts[0] != "READY":
                    raise RuntimeError("Synthetic Brain exited before readiness")
                brain_url = urlparse(parts[1])
                model_url = urlparse(parts[2])
                if (brain_url.scheme != "http" or brain_url.hostname != "127.0.0.1"
                        or model_url.scheme != "http" or model_url.hostname != "127.0.0.1"):
                    raise RuntimeError("Synthetic Brain returned a non-loopback endpoint")
                if brain_url.port != BRAIN_PORT:
                    raise RuntimeError(f"Synthetic Brain must bind the UI's configured loopback port {BRAIN_PORT}")
                brain, model = parts[1], parts[2]
                backend_diagnostics.extend(stderr_lines)
                return process
            except BaseException as error:
                last_error = error
                backend_diagnostics.extend(stderr_lines)
                if stderr_lines:
                    last_error = RuntimeError(f"{error}; stderr_tail={stderr_lines[-8:]}")
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=10)
                for stream in (process.stdin, process.stdout, process.stderr):
                    if stream:
                        stream.close()
        raise last_error or RuntimeError("Synthetic Brain did not become ready")

    def stop_backend(process):
        if process and process.poll() is None:
            process.stdin.write("SHUTDOWN\n")
            process.stdin.flush()
            process.wait(timeout=20)
            assert process.returncode == 0, "Synthetic Brain did not close cleanly"

    def screenshot(page, name):
        page.screenshot(path=str(evidence / (name + ".png")), full_page=True)

    def require_free_brain_port():
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            try:
                listener.bind(("127.0.0.1", BRAIN_PORT))
            except OSError as error:
                raise RuntimeError(
                    f"Required synthetic Brain port 127.0.0.1:{BRAIN_PORT} is occupied; "
                    "the runner will not stop or reuse another process"
                ) from error

    def click(locator):
        nonlocal actions
        locator.click()
        actions += 1

    def fill(locator, value):
        nonlocal actions
        locator.fill(value)
        actions += 1

    def ask(page, question, follow=False):
        answer_turns = page.get_by_test_id("ask-answer-turn")
        previous_turn_count = answer_turns.count()
        fill(page.get_by_test_id("ask-follow-input" if follow else "ask-primary-input"), question)
        click(page.get_by_test_id("ask-follow-send" if follow else "ask-primary-send"))
        expect(answer_turns).to_have_count(previous_turn_count + 1, timeout=30000)
        expect(answer_turns.last).to_contain_text(question)
        expect(page.get_by_test_id("ask-save-receipt")).to_have_attribute("data-state", "saved", timeout=30000)

    try:
        require_free_brain_port()
        class QuietHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(root / "desktop-daemon/out")))
        ui = f"http://127.0.0.1:{server.server_address[1]}"
        env["CORS_ORIGINS"] = ui
        threading.Thread(target=server.serve_forever, daemon=True).start()
        backend = start_backend()
        with sync_playwright() as playwright, ExitStack() as browser_cleanup:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=str(args.browser_executable) if args.browser_executable else None,
            )
            browser_cleanup.callback(lambda: browser.close() if browser else None)
            context = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
            browser_cleanup.callback(lambda: context.close() if context else None)
            # Native IPC is an explicit fixture, not Windows installed-client evidence.
            context.add_init_script("""(() => {
              window.__TAURI_METADATA__ = {__currentWindow:{label:'main'},__windows:[{label:'main'}]};
              window.__TAURI_IPC__ = (m) => {
                let result = null;
                if (m.cmd === 'get_local_api_token') result = TOKEN;
                else if (m.cmd === 'get_mcp_clients_status') result = {};
                else if (m.cmd === 'get_system_status') result = {brain_server_running:true,udp_listener_running:false,last_event:null};
                else if (m.cmd === 'get_pending_import_jobs') result = [];
                else if (m.cmd === 'tauri' && m.__tauriModule === 'Event') result = 1;
                queueMicrotask(() => { const callback=window['_'+m.callback]; if(callback) callback(result); });
              };
              localStorage.setItem('omnicontext_language','zh');
            })();""".replace("TOKEN", json.dumps(token)))
            def network_guard(route):
                hostname = urlparse(route.request.url).hostname
                if hostname not in ("127.0.0.1", "localhost", None):
                    external.append(hostname)
                    route.abort()
                else:
                    route.continue_()
            context.route("**/*", network_guard)
            page = context.new_page()
            pre_ask_graph_answer_requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: pre_ask_graph_answer_requests.append(request.url)
                    if request.method == "POST" and urlparse(request.url).path == "/api/mcp/tool/graph_answer" else None)

            def record_request_failure(request):
                failure = {
                    "method": request.method,
                    "path": urlparse(request.url).path,
                    "failure": request.failure,
                }
                if (request.method == "POST" and urlparse(request.url).path == "/api/discussions"
                        and request.failure == "net::ERR_CONNECTION_FAILED"):
                    failure["injection"] = "history response intentionally dropped after server commit"
                    expected_fault_injections.append(failure)
                elif (request.method == "POST" and urlparse(request.url).path == "/api/mcp/tool/save_decision"
                      and request.failure == "net::ERR_CONNECTION_FAILED"):
                    failure["injection"] = "decision response intentionally dropped after server commit"
                    expected_fault_injections.append(failure)
                else:
                    http_failures.append(failure)

            page.on("requestfailed", record_request_failure)
            page.on("response", lambda response: http_failures.append({
                "method": response.request.method,
                "path": urlparse(response.url).path,
                "status": response.status,
            }) if response.status >= 400 else None)
            page.goto(ui, wait_until="networkidle")
            expect(page.get_by_test_id("startup-splash")).to_be_hidden(timeout=25000)
            expect(page.get_by_text("从上次的事情继续", exact=True)).to_be_visible()
            expect(page.get_by_text("Omni 会从资料中寻找依据并展示来源", exact=False)).to_be_visible()
            check("First use explains a concrete value path and source-grounded answers")
            expect(page.get_by_text("相关资料片段会发送给该服务", exact=False)).to_be_visible()
            expect(page.get_by_text("屏幕与剪贴板捕获默认暂停", exact=False)).to_be_visible()
            check("First use explains remote data flow and that capture is paused by default")
            screenshot(page, "01-first-use-and-privacy")
            fill(page.get_by_role("textbox", name="API 地址", exact=True), model)
            fill(page.get_by_role("textbox", name="模型", exact=True), "fixture-model")
            click(page.get_by_role("button", name="测试连接并保存", exact=True))
            expect(page.get_by_role("button", name="下一步", exact=False)).to_be_enabled(timeout=30000)
            click(page.get_by_role("button", name="下一步", exact=False))
            fixture = [{"title": "合成 Alpha 项目选择", "create_time": 1792281600, "mapping": {
                "user": {"message": {"author": {"role": "user"}, "content": {"parts": [
                    "TEST_FIXTURE：合成资料用于验证导入来源回执和恢复流程，不代表真实用户内容。"]}, "create_time": 1792281600}}}}]
            page.locator('input[type="file"]').set_input_files({"name": "synthetic-alpha.json", "mimeType": "application/json", "buffer": json.dumps(fixture, ensure_ascii=False).encode()})
            actions += 1
            expect(page.get_by_test_id("onboarding-import-receipt")).to_be_visible(timeout=45000)
            screenshot(page, "02-import-receipt")
            click(page.get_by_role("button", name="用这些记忆提问", exact=False))
            check("One synthetic import reaches Ask without automatic inference",
                  len(pre_ask_graph_answer_requests) == 0,
                  details={"graph_answer_requests_before_user_question": len(pre_ask_graph_answer_requests)})

            # Lost history response AFTER a real SQLite commit. Explicit retry
            # must keep the same row ID, not re-run AI or save_decision.
            intercepted_ids = []
            def lose_history(route):
                if route.request.method != "POST":
                    route.continue_()
                    return
                intercepted_ids.append(route.request.post_data_json["id"])
                route.fetch()
                route.abort("connectionfailed")
            page.route(brain + "/api/discussions", lose_history, times=1)
            fill(page.get_by_test_id("ask-primary-input"), "根据合成资料，我应该怎样验证这个项目的下一步？")
            click(page.get_by_test_id("ask-primary-send"))
            expect(page.get_by_test_id("ask-save-receipt")).to_have_attribute("data-state", "error", timeout=30000)
            screenshot(page, "03-save-not-confirmed")
            click(page.get_by_test_id("ask-done-button"))
            expect(page.get_by_role("dialog")).to_be_visible()
            click(page.get_by_role("dialog").get_by_text("留下重试", exact=True))
            click(page.get_by_test_id("ask-save-retry"))
            expect(page.get_by_test_id("ask-save-receipt")).to_have_attribute("data-state", "saved")
            discussions = api("/api/discussions")
            check("Lost receipt retries same history ID with no duplicate", len(discussions) == 1 and discussions[0]["id"] == intercepted_ids[0])
            discussion_id = discussions[0]["id"]
            click(page.get_by_test_id("ask-source-citation").first)
            expect(page.get_by_test_id("ask-source-dialog")).to_be_visible()
            screenshot(page, "04-source-readback")
            page.keyboard.press("Escape")
            check("Answer citation reads a real local entity by ID")

            click(page.get_by_test_id("ask-decision-save"))
            expect(page.get_by_test_id("ask-decision-draft")).to_be_visible()
            check("Opening decision editor does not write a decision", api("/api/decisions")["count"] == 0)
            chosen = "合成用户决定：先验证一个小范围原型，尚未核实实际结果。"
            fill(page.get_by_test_id("ask-decision-draft"), chosen)
            screenshot(page, "05-confirm-my-decision")
            click(page.get_by_test_id("ask-decision-save"))
            expect(page.get_by_test_id("ask-confirmed-decision")).to_have_text(chosen, timeout=30000)
            expect(page.get_by_test_id("ask-save-receipt")).to_have_attribute("data-state", "saved")
            decision_id = api("/api/discussions/" + discussion_id)["turns"][-1]["savedDecisionId"]
            check("User-edited decision and ID persist separately from AI suggestion")
            first_use_actions = actions
            screenshot(page, "06-confirmed-and-saved")

            # Real backend process termination + fresh WebView profile load,
            # keeping only the synthetic SQLite database and settings storage.
            storage = context.storage_state()
            context.close()
            stop_backend(backend)
            backend = start_backend()
            context = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN", storage_state=storage)
            context.add_init_script("window.__TAURI_METADATA__={__currentWindow:{label:'main'},__windows:[{label:'main'}]}; window.__TAURI_IPC__=m=>queueMicrotask(()=>window['_'+m.callback]?.(m.cmd==='get_local_api_token'?" + json.dumps(token) + ":m.cmd==='get_pending_import_jobs'?[]:m.cmd==='get_mcp_clients_status'?{}:m.cmd==='tauri'?1:null));")
            context.route("**/*", network_guard)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(ui, wait_until="networkidle")
            before_resume_actions = actions
            click(page.get_by_test_id("ask-history-button"))
            click(page.get_by_test_id("ask-history-item").first)
            expect(page.get_by_test_id("ask-confirmed-decision")).to_have_text(chosen)
            expect(page.get_by_test_id("ask-save-receipt")).to_have_attribute("data-state", "saved")
            check("Fresh renderer and restarted Brain restore question, sources and confirmed decision")
            resume_actions = actions - before_resume_actions
            screenshot(page, "07-second-use-resumed")
            click(page.get_by_test_id("ask-source-citation").first)
            expect(page.get_by_test_id("ask-source-dialog")).to_be_visible()
            page.keyboard.press("Escape")
            ask(page, "基于刚才的选择，还应该核对什么？", follow=True)
            click(page.get_by_test_id("ask-decision-save"))
            fill(page.get_by_test_id("ask-decision-draft"), "合成后续决定：补做来源核对，结果仍待记录。")
            click(page.get_by_test_id("ask-decision-save"))
            expect(page.get_by_test_id("ask-decision-saved")).to_have_count(2, timeout=30000)
            expect(page.get_by_test_id("ask-save-receipt")).to_have_attribute("data-state", "saved")
            stored = api("/api/discussions/" + discussion_id)
            next_id = stored["turns"][-1]["savedDecisionId"]
            lineage = api("/api/mcp/tool/get_decision_lineage", {"arguments": {"decision_id": next_id}})
            check("Resumed decision links to the previous saved decision", decision_id in json.dumps(lineage))
            mcp = api("/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_decision_context", "arguments": {"situation": "合成用户决定 原型"}}})
            check("Authorized MCP HTTP can retrieve saved personal context", "result" in mcp and "error" not in mcp and not mcp["result"].get("isError") and decision_id in json.dumps(mcp))
            second_use_actions = actions - before_resume_actions

            # Failed history read must not replace a working discussion.
            page.route(brain + "/api/discussions", lambda route: route.fulfill(status=503, body="{}"), times=1)
            click(page.get_by_test_id("ask-history-button"))
            expect(page.get_by_test_id("ask-history-error")).to_be_visible()
            expect(page.get_by_test_id("ask-answer-panel")).to_be_visible()
            click(page.get_by_test_id("ask-history-error").get_by_role("button", name="重试", exact=True))
            expect(page.get_by_test_id("ask-history-item").first).to_be_visible()
            click(page.get_by_test_id("ask-history-button"))
            check("History failure is distinct from empty and has an explicit retry")

            # A decision mutation is NOT an idempotent discussion upsert.
            # Lose its response after commit: the UI must require an explicit
            # retry, then replay the byte-equivalent intent under the same key.
            ask(page, "我还应该如何决定合成项目的验证范围？", follow=True)
            graph_answer_requests = []
            page.on("request", lambda request: graph_answer_requests.append(request.post_data or "")
                    if request.method == "POST" and request.url == brain + "/api/mcp/tool/graph_answer" else None)
            graph_answers_before_retry = len(graph_answer_requests)
            decision_count_before = api("/api/decisions")["count"]
            decision_posts = []
            decision_upstream_statuses = []
            decision_request_events = []
            page.on("request", lambda request: decision_request_events.append({
                "method": request.method,
                "path": urlparse(request.url).path,
            }) if urlparse(request.url).path.endswith("/api/mcp/tool/save_decision") else None)
            def lose_decision(route):
                if route.request.method != "POST":
                    route.continue_()
                    return
                decision_posts.append(route.request.post_data_json)
                if len(decision_posts) == 1:
                    # The API commits, but the renderer receives no receipt.
                    upstream = route.fetch()
                    decision_upstream_statuses.append(upstream.status)
                    route.abort("connectionfailed")
                else:
                    route.continue_()
            page.route("**/api/mcp/tool/save_decision", lose_decision)
            click(page.get_by_test_id("ask-decision-save"))
            click(page.get_by_test_id("ask-decision-save"))
            expect(page.get_by_test_id("ask-decision-uncertain")).to_be_visible(timeout=30000)
            # Wait for the request to leave the in-flight state after the
            # server committed it and the renderer lost its receipt.
            expect(page.get_by_test_id("ask-decision-saving")).to_be_hidden(timeout=30000)
            expect(page.get_by_test_id("ask-decision-retry")).to_be_visible()
            expect(page.get_by_test_id("ask-decision-save")).to_have_count(0)
            screenshot(page, "08-decision-uncertain-before-retry")
            decision_count_after_uncertain = api("/api/decisions")["count"]
            check("Lost decision receipt remains uncertain without automatic replay",
                  len(decision_posts) == 1 and decision_count_after_uncertain == decision_count_before + 1,
                  details={"decision_posts": len(decision_posts), "upstream_statuses": decision_upstream_statuses,
                           "decision_request_events": decision_request_events,
                           "turn_count": page.get_by_test_id("ask-answer-turn").count(),
                           "decisions_before": decision_count_before, "decisions_after": decision_count_after_uncertain})
            click(page.get_by_test_id("ask-decision-retry"))
            # There are already saved decisions from earlier turns. Waiting on
            # `.last` alone can match an old receipt before the retry request
            # leaves the browser; wait for this turn's uncertain marker to be
            # replaced and for the new saved receipt count to appear.
            expect(page.get_by_test_id("ask-decision-uncertain")).to_have_count(0, timeout=30000)
            expect(page.get_by_test_id("ask-decision-saved")).to_have_count(3, timeout=30000)
            check("Explicit retry reuses the exact payload and key without another Ask or duplicate decision",
                  len(decision_posts) == 2
                  and decision_posts[0] == decision_posts[1]
                  and decision_posts[0]["arguments"]["idempotency_key"] == decision_posts[1]["arguments"]["idempotency_key"]
                  and len(graph_answer_requests) == graph_answers_before_retry
                  and api("/api/decisions")["count"] == decision_count_before + 1,
                  details={
                      "decision_posts": len(decision_posts),
                      "payload_equal": len(decision_posts) == 2 and decision_posts[0] == decision_posts[1],
                      "keys_equal": len(decision_posts) == 2 and decision_posts[0]["arguments"].get("idempotency_key") == decision_posts[1]["arguments"].get("idempotency_key"),
                      "graph_answers_before_retry": graph_answers_before_retry,
                      "graph_answers_after_retry": len(graph_answer_requests),
                      "decisions_before": decision_count_before,
                      "decisions_after": api("/api/decisions")["count"],
                      "decision_upstream_statuses": decision_upstream_statuses,
                  })
            # The decision receipt is immediate; its link in the persisted Ask
            # history is a separate write and must reach its own saved receipt.
            expect(page.get_by_test_id("ask-save-receipt")).to_have_attribute("data-state", "saved", timeout=30000)
            retried_turn = api("/api/discussions/" + discussion_id)["turns"][-1]
            decision_log = api("/api/decisions")["decisions"]
            check("Recovered decision receipt is recorded in the decision log",
                  retried_turn.get("savedAsDecision") is True
                  and any(item["id"] == retried_turn.get("savedDecisionId")
                          and item["conclusion"] == decision_posts[1]["arguments"]["conclusion"]
                          for item in decision_log))
            expect(page.get_by_test_id("ask-save-receipt")).to_have_attribute("data-state", "saved")
            click(page.get_by_test_id("ask-done-button"))
            expect(page.get_by_test_id("ask-answer-panel")).to_have_count(0)
            click(page.get_by_test_id("ask-history-button"))
            click(page.get_by_test_id("ask-history-item").first)
            expect(page.get_by_test_id("ask-confirmed-decision").last).to_have_text(decision_posts[1]["arguments"]["conclusion"])
            check("Closing and reopening the discussion refreshes the saved decision result",
                  len(graph_answer_requests) == graph_answers_before_retry)
            screenshot(page, "08-decision-recovered-and-resumed")
            page.set_viewport_size({"width": 390, "height": 640})
            screenshot(page, "09-narrow-resumed-discussion")
            panel = page.get_by_test_id("ask-answer-panel").bounding_box()
            check("Narrow layout gives Ask a full-width reading view and hides graph controls",
                  panel and panel["x"] <= 1 and panel["width"] >= 380
                  and page.get_by_test_id("graph-toolbar").is_hidden())
            page.set_viewport_size({"width": 390, "height": 480})
            composer = page.get_by_test_id("ask-follow-input").bounding_box()
            screenshot(page, "10-short-window-resumed-discussion")
            check("Short window keeps the follow-up composer visible inside the viewport",
                  composer and composer["y"] >= 0 and composer["y"] + composer["height"] <= 480)
            check("No external browser requests or uncaught UI errors", not external and not errors)
            context.close()
            context = None
            result = {"status": "CONTROLLED_RUNTIME_PASS", "kind": "Headless browser + real Brain HTTP/SQLite + deterministic loopback model + fixture native IPC",
                "not_proven": ["new installed-client acceptance", "real provider quality", "third-party client handshake", "human usability or retention"],
                "first_use_actions": first_use_actions,
                "resume_open_actions": resume_actions,
                "second_use_actions": second_use_actions,
                "counting": "Each click, text fill and file choice is one scripted action. Second-use count ends after resuming history, inspecting a source, asking a follow-up, and saving a follow-up decision; typing effort and waiting are not included.",
                **git_metadata(),
                "desktop_bundle_sha256": sha256_directory(root / "desktop-daemon" / "out"),
                "backend_start_attempts": backend_start_attempts,
                    "backend_diagnostics": backend_diagnostics[-40:],
                "checks": checks, "external_requests": external,
                "expected_fault_injections": expected_fault_injections,
                "http_failures": http_failures, "page_errors": errors}
            (evidence / "alpha-runtime-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            browser.close()
            browser = None
    except Exception as error:
        if page:
            try:
                page.screenshot(path=str(evidence / "alpha-runtime-failure.png"), full_page=True)
            except Exception:
                pass
        failure = {
            "status": "FAIL",
            "error": str(error),
            **git_metadata(),
            "desktop_bundle_sha256": sha256_directory(root / "desktop-daemon" / "out"),
            "backend_start_attempts": backend_start_attempts,
                "backend_diagnostics": backend_diagnostics[-40:],
            "checks": checks,
            "expected_fault_injections": expected_fault_injections,
            "http_failures": http_failures,
            "page_errors": errors,
        }
        (evidence / "alpha-runtime-failure.json").write_text(json.dumps(failure, ensure_ascii=False, indent=2), encoding="utf-8")
        raise
    finally:
        if context:
            try:
                context.close()
            except Exception:
                pass
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        stop_backend(backend)
        if server:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
