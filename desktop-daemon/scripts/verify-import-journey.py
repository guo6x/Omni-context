"""Headless, authenticated import journey against an in-memory test backend.

Requires Python Playwright, Chromium/Edge, Node and the repository dependencies.
The native IPC bridge and AI are fixtures. This is NOT installed-app acceptance.
The frontend must be running with NEXT_PUBLIC_BRAIN_URL matching --api-port.
"""
from __future__ import annotations

import argparse
from ipaddress import ip_address
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def conversations(partial: bool = True) -> bytes:
    texts = ["TEST_FIXTURE：合成资料用于验证导入来源回执和恢复流程，不代表真实用户内容。"]
    if partial:
        texts.append("[fixture-fail] 这段对话用于验证未完成的导入不会被算成成功。")
    return json.dumps([
        {"title": f"Omni import fixture {index}", "create_time": 1780272000 + index,
         "mapping": {"u": {"message": {"author": {"role": "user"},
             "content": {"parts": [text]}, "create_time": 1780272000 + index}}}}
        for index, text in enumerate(texts)
    ], ensure_ascii=False).encode("utf-8")


def loopback_origin(value: str) -> str:
    parsed = urlsplit(value)
    host = parsed.hostname
    if parsed.scheme not in ("http", "https") or not host or parsed.username or parsed.password:
        raise ValueError("--app-url must be an HTTP(S) loopback origin without credentials")
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("--app-url contains an invalid port") from error
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("--app-url contains an invalid port")
    try:
        is_loopback = host.lower() == "localhost" or ip_address(host).is_loopback
    except ValueError:
        is_loopback = host.lower() == "localhost"
    if not is_loopback:
        raise ValueError("--app-url must resolve to a loopback host; fixture tokens are never sent to remote pages")
    if parsed.query or parsed.fragment:
        raise ValueError("--app-url must not contain a query or fragment")
    return f"{parsed.scheme}://{parsed.netloc}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-url", default="http://localhost:3018",
                        help="HTTP(S) loopback app URL only; remote pages must never receive the fixture token")
    parser.add_argument("--api-port", type=int, default=4318)
    parser.add_argument("--llm-port", type=int, default=4319)
    parser.add_argument("--output-dir", type=Path, required=True,
                        help="new output directory; existing directories and symlinks are never overwritten")
    parser.add_argument("--channel", default="msedge")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    app_origin = loopback_origin(args.app_url)
    if not 1 <= args.api_port <= 65535 or not 1 <= args.llm_port <= 65535 or args.api_port == args.llm_port:
        raise ValueError("--api-port and --llm-port must be distinct valid TCP ports")
    requested_output = args.output_dir.absolute()
    if requested_output.exists() or requested_output.is_symlink():
        raise FileExistsError("--output-dir must be new; refusing to overwrite an existing directory or symlink")
    output = requested_output
    output.mkdir(parents=True, exist_ok=False)
    chat_file = output / "conversations.json"
    chat_file.write_bytes(conversations())
    note_file = output / "notes.txt"
    note_file.write_text("TEST_FIXTURE：合成资料用于验证导入来源回执和恢复流程，不代表真实用户内容。", encoding="utf-8")
    token = secrets.token_hex(32)
    api = f"http://127.0.0.1:{args.api_port}"
    llm = f"http://127.0.0.1:{args.llm_port}/v1"
    # Keep the local fixture child process independent from unrelated host
    # secrets (provider tokens, cloud credentials, and user-defined NODE_OPTIONS).
    inherited_process_environment = (
        "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC",
        "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
    )
    env = {key: os.environ[key] for key in inherited_process_environment if key in os.environ}
    env.update({"OMNI_DESKTOP_IMPORT_FIXTURE": "1", "LOCAL_API_TOKEN": token,
                "PORT": str(args.api_port), "OMNI_FIXTURE_LLM_PORT": str(args.llm_port),
                "CORS_ORIGINS": app_origin, "LLM_API_URL": llm,
                "LLM_MODEL": "fixture-model", "LLM_API_KEY": "", "OMNI_REMOTE_AI_ENABLED": "false",
                "OMNI_AI_AUDIT_PATH": str(output / "fixture-ai-audit.jsonl")})
    command = [shutil.which("node") or "node", "--import", "tsx",
               str(repo / "brain-server/tests/fixtures/desktop-import-server.ts")]
    results: list[dict] = []
    errors: list[str] = []
    all_requests: list[dict] = []
    responses: list[dict] = []
    pending_requests: dict[str, str] = {}
    pending_at_failure: list[str] = []
    finished_requests: list[str] = []
    blocked: list[str] = []
    backend = None
    backend_cleanup = {"mode": "not_started", "exit_code": None}
    cleanup_error = None
    browser = None
    contexts = []
    active_page = None
    playwright = None

    def request(path: str, data=None, authenticated=True):
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(api + path, headers=headers,
            data=json.dumps(data).encode() if data is not None else None)
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.load(response)

    def passed(name: str, **detail):
        results.append({"check": name, "status": "PASS", **detail})
        print(f"PASS {name}", flush=True)

    try:
        for port in (args.api_port, args.llm_port):
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))
        with (output / "fixture-server.log").open("w", encoding="utf-8") as log:
            backend = subprocess.Popen(command, cwd=repo / "brain-server", env=env,
                stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.PIPE, text=True, encoding="utf-8",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            deadline = time.monotonic() + 180
            while True:
                if backend.poll() is not None:
                    raise RuntimeError("Isolated backend exited; inspect fixture-server.log")
                try:
                    request("/health")
                    break
                except (urllib.error.URLError, TimeoutError):
                    if time.monotonic() > deadline:
                        raise TimeoutError("Isolated backend was not ready within 180 seconds")
                    time.sleep(0.2)

            try:
                request("/api/graph/context", {"depth": 3, "limit": 50}, authenticated=False)
                raise AssertionError("Protected data path accepted a missing token")
            except urllib.error.HTTPError as failure:
                assert failure.code == 401
            passed("protected_api_rejects_missing_token")

            playwright = sync_playwright().start()
            if playwright:
                browser = playwright.chromium.launch(headless=True, channel=args.channel or None)
                allowed = {urlsplit(app_origin).netloc, urlsplit(api).netloc, urlsplit(llm).netloc}

                def new_page(width=1280, height=900, onboarded=False, excluded_graph_ids=(), import_recoveries=(), disable_web_crypto=False):
                    nonlocal active_page
                    context = browser.new_context(viewport={"width": width, "height": height},
                                                  locale="zh-CN", reduced_motion="reduce")
                    contexts.append(context)
                    def restrict(route):
                        target = urlsplit(route.request.url)
                        if target.scheme in ("http", "https") and target.netloc not in allowed:
                            blocked.append(target.netloc)
                            route.abort()
                        else:
                            route.continue_()
                    context.route("**/*", restrict)
                    settings = {"llmProvider": {"apiUrl": llm, "model": "fixture-model", "apiKey": ""},
                                "behavior": {"onboarded": onboarded}}
                    # Only this throwaway browser receives the fixture token. The server
                    # still uses the unchanged production authentication middleware.
                    context.add_init_script("""
                        localStorage.setItem('omnicontext_language', 'zh');
                        localStorage.setItem('omnicontext-settings', JSON.stringify(SETTINGS));
                        localStorage.setItem('omni_onboarded', String(ONBOARDED));
                        if (RECOVERIES !== null) localStorage.setItem('omni-context.pending-import-jobs.v1', RECOVERIES);
                        window.__TAURI_METADATA__ = {__windows:[{label:'main'}],__currentWindow:{label:'main'}};
                        window.__OMNI_FIXTURE_IPC_COMMANDS__ = [];
                        window.__TAURI_IPC__ = message => {
                            window.__OMNI_FIXTURE_IPC_COMMANDS__.push(message.cmd);
                            let value = null;
                            if (message.cmd === 'get_local_api_token') value = TOKEN;
                            else if (message.cmd === 'set_close_behavior') value = null;
                            else if (message.cmd === 'tauri') {
                                value = message.message?.cmd === 'listen' ? 1 : false;
                            } else {
                                queueMicrotask(() => window[`_${message.error}`]?.('Native command is not part of this fixture'));
                                return;
                            }
                            queueMicrotask(() => window[`_${message.callback}`]?.(value));
                        };
                    """.replace("SETTINGS", json.dumps(settings)).replace("ONBOARDED", json.dumps(onboarded))
                         .replace("RECOVERIES", json.dumps(json.dumps(import_recoveries) if import_recoveries else None))
                         .replace("TOKEN", json.dumps(token)))
                    if disable_web_crypto:
                        context.add_init_script("Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: undefined });")
                    page = context.new_page()
                    active_page = page
                    if excluded_graph_ids:
                        def cap_graph(route):
                            response = route.fetch()
                            data = response.json()
                            data["entities"] = [entity for entity in data.get("entities", [])
                                                if entity["id"] not in excluded_graph_ids]
                            data["relationships"] = [edge for edge in data.get("relationships", [])
                                if edge["source_id"] not in excluded_graph_ids and edge["target_id"] not in excluded_graph_ids]
                            route.fulfill(response=response, body=json.dumps(data))
                        page.route(api + "/api/graph/context", cap_graph)
                    page.on("pageerror", lambda error: errors.append(error.stack or str(error)))
                    request_key = lambda req: req._impl_obj._guid
                    page.on("request", lambda req: pending_requests.update({request_key(req): urlsplit(req.url).path}))
                    def finish_request(req):
                        pending_requests.pop(request_key(req), None)
                        finished_requests.append(urlsplit(req.url).path)
                    page.on("requestfinished", finish_request)
                    page.on("requestfailed", finish_request)
                    page.on("response", lambda response: responses.append({"path": urlsplit(response.url).path, "status": response.status}))
                    page.on("request", lambda req: all_requests.append({"method": req.method,
                        "path": urlsplit(req.url).path}) if req.url.startswith(api) else None)
                    page.goto(args.app_url, wait_until="domcontentloaded", timeout=120000)
                    # The app keeps probing the local server, so network-idle may never
                    # settle. Wait for the native bridge and the hydrated workspace UI.
                    page.wait_for_function("window.__OMNI_FIXTURE_IPC_COMMANDS__.includes('get_local_api_token')", timeout=30000)
                    expect(page.get_by_test_id("workspace-navigation")).to_be_visible(timeout=30000)
                    return page, context

                def open_import(page):
                    expect(page.get_by_label("API URL", exact=True)).to_have_value(llm)
                    expect(page.get_by_label("Model", exact=True)).to_have_value("fixture-model")
                    with page.expect_response(lambda r: r.url.endswith('/api/settings/llm') and r.request.method == 'POST') as tested:
                        page.get_by_role("button", name="测试连接并保存", exact=True).click()
                    test_result = tested.value.json()
                    assert tested.value.ok and test_result.get('healthy'), {"status": tested.value.status, "result": test_result}
                    expect(page.get_by_role("button", name="下一步", exact=True)).to_be_enabled(timeout=15000)
                    page.get_by_role("button", name="下一步", exact=True).click()
                    expect(page.get_by_role("heading", name="先导入一份熟悉的记录")).to_be_visible()

                def upload_chat(page):
                    page.get_by_label("导入聊天记录、文档或笔记", exact=True).set_input_files(str(chat_file))

                def answer_payload(question, source=None):
                    return {"conclusion": f"受控回答：{question}",
                        "reasons": [{"text": "核查这条已保存记忆", "entityIds": [source["id"]]}] if source else [],
                        "questions": [], "isDecision": False,
                        "sources": [source] if source else [], "citedEntityIds": [source["id"]] if source else []}

                def answer_immediately(route):
                    question_text = route.request.post_data_json["arguments"]["messages"][-1]["content"]
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(answer_payload(question_text)))

                def submit_primary(page, text):
                    page.get_by_test_id("ask-primary-input").fill(text)
                    page.get_by_test_id("ask-primary-input").press("Enter")

                def render_fence(page):
                    page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")

                def wait_for_fixture(page, predicate, label):
                    # Route.fetch() may still be dispatching after expect_request fires.
                    # Pump Playwright until the explicit fixture condition, not a guessed delay.
                    deadline = time.monotonic() + 10
                    while not predicate():
                        if time.monotonic() >= deadline:
                            raise AssertionError(f"Timed out waiting for controlled fixture: {label}")
                        page.wait_for_timeout(20)

                page, context = new_page()
                open_import(page)
                passed("saved_provider_survives_first_load")
                started = len(all_requests)
                with page.expect_response(lambda r: r.url.endswith("/api/import/chat") and r.request.method == "POST") as first_import:
                    upload_chat(page)
                terminal_job_id = first_import.value.json()["jobId"]
                receipt = page.get_by_test_id("onboarding-import-receipt")
                expect(receipt).to_be_visible(timeout=30000)
                expect(receipt).to_contain_text("成功处理 1/2 段")
                expect(receipt).to_contain_text("1 段未完成")
                expect(page.get_by_role("alert").filter(has_text="部分内容已导入")).to_be_visible()
                review = page.get_by_role("button", name="已核对记忆库，允许重新选择", exact=True)
                expect(review).to_be_visible()
                expect(page.get_by_role("button", name="选择或拖入聊天记录、文档或笔记")).to_be_disabled()
                stored = page.evaluate("() => JSON.parse(localStorage.getItem('omni-context.pending-import-jobs.v1') || '[]')")
                assert len(stored) == 1 and stored[0]["owner"] == "onboarding" and stored[0]["jobId"] == terminal_job_id, stored
                assert set(stored[0]) == {"kind", "owner", "jobId", "savedAt"}, stored
                writes = [r for r in all_requests[started:] if r["method"] == "POST" and r["path"] in
                          ("/api/import/chat", "/api/ingest/file")]
                assert len(writes) == 1, writes
                assert not any(r["path"].endswith(("/ask_memory", "/graph_answer")) for r in all_requests)
                page.screenshot(path=str(output / "onboarding-partial-desktop.png"), full_page=True)
                passed("genuine_partial_import_stops_with_truthful_receipt", submission_count=len(writes))

                page.get_by_role("button", name="用这些记忆提问").click()
                expect(receipt).not_to_be_visible()
                question = page.get_by_test_id("ask-primary-input")
                expect(question).to_be_focused(timeout=15000)
                expect(question).to_have_value("请基于我已导入的记忆，概括其中的重要信息，并说明依据和不确定之处。")
                expect(page.get_by_test_id("ask-first-empty-state")).to_be_visible(timeout=15000)
                passed("import_refreshes_home_and_hands_off_without_auto_asking")
                with page.expect_response(lambda r: r.url.endswith("/api/mcp/tool/graph_answer")) as answer_response:
                    page.get_by_role("button", name="发送", exact=True).click()
                answer = answer_response.value.json()
                graph = request("/api/graph/context", {"depth": 3, "limit": 50})
                saved_ids = {entity["id"] for entity in graph["entities"]}
                assert answer.get("sources"), answer
                assert set(answer.get("citedEntityIds", [])) & saved_ids, answer
                expect(page.get_by_text(answer["conclusion"], exact=True)).to_be_visible()
                page.screenshot(path=str(output / "imported-answer-sources.png"), full_page=True)
                passed("explicit_ask_returns_persisted_source_ids", sources=len(answer["sources"]))

                citation = page.get_by_test_id("ask-source-citation").first
                cited_id = citation.get_attribute("data-source-id")
                cited_entity = request(f"/api/entities/{cited_id}")["entity"]
                citation.click()
                source_dialog = page.get_by_test_id("ask-source-dialog")
                expect(source_dialog).to_have_attribute("data-source-status", "ready")
                expect(source_dialog).to_contain_text(cited_entity["description"])
                expect(source_dialog).to_contain_text(cited_id)
                expect(page.get_by_test_id("ask-answer-panel")).to_be_visible()
                page.screenshot(path=str(output / "imported-answer-source-details.png"), full_page=True)
                page.keyboard.press("Escape")
                expect(source_dialog).to_have_count(0)
                expect(citation).to_be_focused()
                expect(page.get_by_test_id("ask-answer-panel")).to_be_visible()
                passed("actual_citation_opens_persisted_source_without_losing_answer")

                # A pending previous question must not overwrite the imported
                # question or keep its explicit Send action disabled.
                held_answers = []
                page.route(api + "/api/mcp/tool/graph_answer", lambda route: held_answers.append(route))
                command_bar = question.locator('..')
                question.fill("这是切换导入前的旧问题")
                command_bar.get_by_role("button", name="发送", exact=True).click()
                expect(command_bar.get_by_role("button", name="发送", exact=True)).to_have_count(0)
                page.get_by_role("button", name="设置", exact=True).click()
                page.get_by_role("button", name="行为", exact=True).click()
                page.get_by_role("button", name="启动引导", exact=True).click()
                before_handoff = len([r for r in all_requests if r["path"] == "/api/mcp/tool/graph_answer"])
                page.evaluate("""() => {
                    window.__askInputBeforeImportHandoff = document.querySelector('[data-testid="ask-primary-input"]');
                }""")
                page.get_by_role("button", name="用这些记忆提问", exact=True).click()
                expect(question).to_be_focused()
                expect(question).to_have_value("请基于我已导入的记忆，概括其中的重要信息，并说明依据和不确定之处。")
                expect(command_bar.get_by_role("button", name="发送", exact=True)).to_be_enabled()
                assert page.evaluate("""() => window.__askInputBeforeImportHandoff ===
                    document.querySelector('[data-testid="ask-primary-input"]')"""), "Ask input remounted during import handoff"
                page.screenshot(path=str(output / "imported-ask-handoff-desktop.png"), full_page=True)
                assert len(held_answers) == 1
                held_answers[0].fulfill(status=200, content_type="application/json", body=json.dumps({
                    "conclusion": "迟到的旧回答不应出现", "sources": [], "citedEntityIds": []}))
                page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                expect(page.get_by_test_id("ask-answer-panel")).to_have_count(0)
                assert len([r for r in all_requests if r["path"] == "/api/mcp/tool/graph_answer"]) == before_handoff
                passed("imported_handoff_ignores_late_previous_answer_without_auto_asking",
                       status_read="old answer injected", ask_input_dom_preserved=True,
                       graph_engine_loading_at_handoff=page.get_by_test_id("graph-engine-loading").count() > 0)
                context.close()

                # A terminal partial job remains recoverable after a renderer restart.
                # Confirming review only unlocks the picker; a later manual selection owns the next POST.
                page, context = new_page(import_recoveries=[{
                    "kind": "job", "owner": "onboarding", "jobId": terminal_job_id, "savedAt": 1780272000000}])
                open_import(page)
                resume = page.get_by_role("button", name="继续检查原任务", exact=True)
                expect(resume).to_be_visible()
                expect(page.get_by_role("button", name="选择或拖入聊天记录、文档或笔记")).to_be_disabled()
                started = len(all_requests)
                resume.click()
                expect(page.get_by_test_id("onboarding-import-receipt")).to_be_visible(timeout=30000)
                expect(page.get_by_role("button", name="已核对记忆库，允许重新选择", exact=True)).to_be_visible()
                assert not [r for r in all_requests[started:] if r["method"] == "POST"
                            and r["path"] in ("/api/import/chat", "/api/ingest/file")]
                page.get_by_role("button", name="已核对记忆库，允许重新选择", exact=True).click()
                expect(page.get_by_role("button", name="选择或拖入聊天记录、文档或笔记")).to_be_enabled()
                assert not [r for r in all_requests[started:] if r["method"] == "POST"
                            and r["path"] in ("/api/import/chat", "/api/ingest/file")]
                with page.expect_response(lambda r: r.url.endswith("/api/import/chat") and r.request.method == "POST"):
                    upload_chat(page)
                expect(page.get_by_test_id("onboarding-import-receipt")).to_be_visible(timeout=30000)
                passed("onboarding_terminal_partial_survives_restart_and_requires_manual_reselection")
                context.close()

                # Delay an already-persisted first save independently of the Ask response.
                # Its returned ID must remain attached to Q1 after Q2 starts.
                page, context = new_page(onboarded=True)
                held_saves, saved_requests, second_answer = [], [], []
                def hold_first_save(route):
                    if route.request.method != "POST":
                        route.continue_()
                        return
                    saved_requests.append(route.request.post_data_json)
                    response = route.fetch()
                    if len(saved_requests) == 1:
                        held_saves.append((route, response))
                    else:
                        route.fulfill(response=response)
                def hold_second_answer(route):
                    text = route.request.post_data_json["arguments"]["messages"][-1]["content"]
                    if text == "隔离新首问 Q2":
                        second_answer.append(route)
                    else:
                        answer_immediately(route)
                page.route(api + "/api/discussions", hold_first_save)
                page.route(api + "/api/mcp/tool/graph_answer", hold_second_answer)
                with page.expect_request(lambda r: r.url.endswith("/api/discussions") and r.method == "POST"):
                    submit_primary(page, "隔离旧首问 Q1")
                expect(page.get_by_test_id("ask-answer-panel")).to_contain_text("受控回答：隔离旧首问 Q1")
                wait_for_fixture(page, lambda: len(held_saves) == 1, "first save persisted and response held")
                first_saved_id = held_saves[0][1].json()["id"]
                with page.expect_request(lambda r: r.url.endswith("/api/mcp/tool/graph_answer")):
                    submit_primary(page, "隔离新首问 Q2")
                expect(page.get_by_test_id("ask-answer-panel")).to_have_count(0)
                wait_for_fixture(page, lambda: len(second_answer) == 1, "second answer held")
                held_saves[0][0].fulfill(response=held_saves[0][1])
                render_fence(page)
                with page.expect_response(lambda r: r.url.endswith("/api/discussions") and r.request.method == "POST") as second_saved:
                    second_answer[0].fulfill(status=200, content_type="application/json",
                        body=json.dumps(answer_payload("隔离新首问 Q2")))
                assert len(saved_requests) == 2 and saved_requests[1].get("id") is None, saved_requests
                assert second_saved.value.json()["id"] != first_saved_id
                assert request(f"/api/discussions/{first_saved_id}")["turns"][0]["question"] == "隔离旧首问 Q1"
                passed("late_old_save_cannot_attach_old_discussion_id_to_new_primary", status_read="real persistence; first save response held")
                context.close()

                # Two answers in the same discussion still serialize behind its first save.
                page, context = new_page(onboarded=True)
                held_saves, saved_requests = [], []
                page.route(api + "/api/discussions", hold_first_save)
                page.route(api + "/api/mcp/tool/graph_answer", answer_immediately)
                with page.expect_request(lambda r: r.url.endswith("/api/discussions") and r.method == "POST"):
                    submit_primary(page, "连续会话首问")
                expect(page.get_by_test_id("ask-answer-panel")).to_contain_text("受控回答：连续会话首问")
                wait_for_fixture(page, lambda: len(held_saves) == 1, "follow-up first save persisted and held")
                first_saved_id = held_saves[0][1].json()["id"]
                page.get_by_test_id("ask-follow-input").fill("连续会话追问")
                page.get_by_test_id("ask-follow-input").press("Enter")
                expect(page.get_by_test_id("ask-answer-panel")).to_contain_text("受控回答：连续会话追问")
                render_fence(page)
                assert len(saved_requests) == 1, saved_requests
                with page.expect_response(lambda r: r.url.endswith("/api/discussions") and r.request.method == "POST"
                                          and len(r.request.post_data_json["turns"]) == 2):
                    held_saves[0][0].fulfill(response=held_saves[0][1])
                assert saved_requests[1]["id"] == first_saved_id
                assert len(request(f"/api/discussions/{first_saved_id}")["turns"]) == 2
                passed("fast_followup_saves_once_to_same_discussion_after_first_id_arrives", status_read="real persistence; first save response held")
                context.close()

                target_turn = {"question": "原有历史问题", "conclusion": "原有历史内容必须保留", "reasons": [],
                               "questions": [], "isDecision": False, "sources": [], "citedEntityIds": []}
                target = request("/api/discussions", {"title": "生命周期测试目标历史", "turns": [target_turn]})
                for action in ("done", "escape", "history"):
                    page, context = new_page(onboarded=True)
                    late_answers, session_saves = [], []
                    def hold_late_answer(route):
                        text = route.request.post_data_json["arguments"]["messages"][-1]["content"]
                        if text == "不应恢复的旧追问":
                            late_answers.append(route)
                        else:
                            answer_immediately(route)
                    def record_save(route):
                        if route.request.method == "POST":
                            session_saves.append(route.request.post_data_json)
                        route.continue_()
                    page.route(api + "/api/mcp/tool/graph_answer", hold_late_answer)
                    page.route(api + "/api/discussions", record_save)
                    with page.expect_response(lambda r: r.url.endswith("/api/discussions") and r.request.method == "POST"):
                        submit_primary(page, f"生命周期首问 {action}")
                    page.get_by_test_id("ask-follow-input").fill("不应恢复的旧追问")
                    with page.expect_request(lambda r: r.url.endswith("/api/mcp/tool/graph_answer")):
                        page.get_by_test_id("ask-follow-input").press("Enter")
                    wait_for_fixture(page, lambda: len(late_answers) == 1, "old follow-up held")
                    if action == "done":
                        page.get_by_test_id("ask-done-button").click()
                    elif action == "escape":
                        page.keyboard.press("Escape")
                    else:
                        page.get_by_test_id("ask-history-button").click()
                        page.get_by_text("生命周期测试目标历史", exact=True).click()
                        expect(page.get_by_test_id("ask-answer-panel")).to_contain_text(target_turn["conclusion"])
                    late_answers[0].fulfill(status=200, content_type="application/json",
                        body=json.dumps(answer_payload("不应恢复的旧追问")))
                    render_fence(page)
                    if action == "history":
                        expect(page.get_by_test_id("ask-answer-panel")).to_contain_text(target_turn["conclusion"])
                    else:
                        expect(page.get_by_test_id("ask-answer-panel")).to_have_count(0)
                        expect(page.get_by_test_id("ask-primary-input").locator('..').get_by_role("button", name="发送", exact=True)).to_have_count(1)
                    assert len(session_saves) == 1, session_saves
                    assert request(f"/api/discussions/{target['id']}")["turns"] == [target_turn]
                    passed(f"late_ask_after_{action}_cannot_reopen_or_overwrite_history", status_read="real persistence; old answer injected")
                    context.close()

                # Persist a source which the delivered graph deliberately excludes.
                source_entity = request("/api/entities", {"name": "图谱容量外的来源记忆", "type": "concept",
                    "description": "这是已保存的来源记录。" * 70,
                    "metadata": {"provenance": {"source": "import", "platform": "controlled-fixture", "import_batch_id": "source-check-batch"}}})
                source = {key: source_entity[key] for key in ("id", "name", "type", "description")}
                page, context = new_page(width=390, height=400, onboarded=True, excluded_graph_ids=(source["id"],))
                page.route(api + "/api/mcp/tool/graph_answer", lambda route: route.fulfill(status=200,
                    content_type="application/json", body=json.dumps(answer_payload("容量外来源", source))))
                submit_primary(page, "容量外来源")
                citation = page.get_by_test_id("ask-source-citation")
                expect(citation).to_be_visible()
                citation.click()
                source_dialog = page.get_by_test_id("ask-source-dialog")
                expect(source_dialog).to_have_attribute("data-source-status", "ready")
                expect(source_dialog).to_contain_text(source_entity["description"])
                expect(source_dialog).to_contain_text("source-check-batch")
                assert source_dialog.evaluate("""element => {
                    const b = element.getBoundingClientRect();
                    return b.x >= 0 && b.y >= 0 && b.right <= innerWidth && b.bottom <= innerHeight;
                }""")
                assert source_dialog.locator('div.overflow-y-auto').evaluate("element => element.scrollHeight > element.clientHeight")
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                page.keyboard.press("Shift+Tab")
                assert source_dialog.evaluate("element => element.contains(document.activeElement)")
                page.screenshot(path=str(output / "source-details-outside-graph-mobile.png"), full_page=True)
                page.keyboard.press("Escape")
                expect(citation).to_be_focused()
                expect(page.get_by_test_id("ask-answer-panel")).to_be_visible()
                passed("out_of_graph_source_reads_exact_persisted_id_in_scrollable_mobile_dialog", viewport="390x400")
                for failure in ("missing", "identity", "credentials"):
                    def source_failure(route, _request, mode=failure):
                        route.fulfill(status=404 if mode == "missing" else 401 if mode == "credentials" else 200,
                            content_type="application/json", body=json.dumps({"error": mode} if mode != "identity"
                                else {"entity": {**source_entity, "id": "wrong-source-id"}, "relationships": []}))
                    page.route(api + f"/api/entities/{source['id']}", source_failure)
                    citation.click()
                    expect(source_dialog).to_have_attribute("data-source-status", failure)
                    expect(source_dialog.get_by_role("alert")).to_be_visible()
                    assert source_entity["description"] not in source_dialog.inner_text()
                    page.unroute(api + f"/api/entities/{source['id']}", source_failure)
                    before_retry = len([r for r in all_requests if r["path"] == "/api/mcp/tool/graph_answer"])
                    source_dialog.get_by_role("button", name="重新读取来源", exact=True).click()
                    expect(source_dialog).to_have_attribute("data-source-status", "ready")
                    assert len([r for r in all_requests if r["path"] == "/api/mcp/tool/graph_answer"]) == before_retry
                    page.keyboard.press("Escape")
                    passed(f"source_{failure}_never_displays_unverified_answer_summary", status_read="injected read failure")
                context.close()

                # Inject only the first read failure. All writes and later reads
                # still use real routes and the exact same acknowledged job.
                page, context = new_page()
                open_import(page)
                attempts = []
                def interrupt_once(route):
                    attempts.append(urlsplit(route.request.url).path)
                    if len(attempts) == 1:
                        route.fulfill(status=503, content_type="application/json", body='{"error":"fixture outage"}')
                    else:
                        route.continue_()
                page.route(api + "/api/ingest/job/**", interrupt_once)
                started = len(all_requests)
                upload_chat(page)
                resume = page.get_by_role("button", name="继续检查原任务", exact=True)
                expect(resume).to_be_visible(timeout=15000)
                expect(page.get_by_role("button", name="选择或拖入聊天记录、文档或笔记")).to_be_disabled()
                page.locator('[data-retained-panel="onboarding"]').get_by_role("button", name="跳过引导", exact=True).first.click()
                expect(page.locator('[data-retained-panel="onboarding"]')).to_be_hidden()
                page.get_by_test_id("workspace-nav-library").click()
                library = page.locator('[data-retained-panel="library"]')
                library.get_by_role("button", name="导入", exact=True).first.click()
                library.locator('input[type="file"]').set_input_files({"name": "same-content-renamed.json",
                    "mimeType": "application/json", "buffer": chat_file.read_bytes()})
                duplicate_notice = library.get_by_role("status").filter(has_text="相同内容")
                expect(duplicate_notice).to_contain_text("首次使用引导")
                expect(duplicate_notice).to_contain_text("已阻止重复上传")
                assert len([r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/import/chat"]) == 1
                page.get_by_role("button", name="关闭记忆管理", exact=True).click()
                passed("pending_import_blocks_same_content_renamed_file_from_another_entrypoint", submission_count=1)
                page.get_by_role("button", name="设置", exact=True).click()
                page.get_by_role("button", name="行为", exact=True).click()
                page.get_by_role("button", name="启动引导", exact=True).click()
                expect(resume).to_be_visible()
                expect(page.get_by_role("button", name="选择或拖入聊天记录、文档或笔记")).to_be_disabled()
                resume.click()
                expect(page.get_by_test_id("onboarding-import-receipt")).to_be_visible(timeout=30000)
                assert len(set(attempts)) == 1, attempts
                writes = [r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/import/chat"]
                assert len(writes) == 1, writes
                passed("closing_and_reopening_resumes_same_job_without_reupload", submission_count=1,
                       status_read="first GET injected 503; later GETs use real route")
                context.close()

                for status, expected in [(401, "连接凭证已失效"), (404, "任务记录已过期")]:
                    page, context = new_page()
                    open_import(page)
                    page.route(api + "/api/ingest/job/**", lambda route, _request, s=status: route.fulfill(
                        status=s, content_type="application/json", body='{"error":"fixture status"}'))
                    upload_chat(page)
                    expect(page.get_by_role("alert").filter(has_text=expected)).to_be_visible(timeout=15000)
                    expect(page.get_by_role("button", name="选择或拖入聊天记录、文档或笔记")).to_be_disabled()
                    if status == 401:
                        expect(page.get_by_role("button", name="继续检查原任务", exact=True)).to_be_visible()
                    else:
                        expect(page.get_by_role("button", name="已核对记忆库，允许重新选择", exact=True)).to_be_visible()
                    assert page.get_by_test_id("onboarding-import-receipt").count() == 0
                    passed(f"http_{status}_is_not_reported_as_success", status_read="injected fixture")
                    context.close()

                page, context = new_page(width=390, height=844)
                open_import(page)
                upload_chat(page)
                expect(page.get_by_test_id("onboarding-import-receipt")).to_be_visible(timeout=30000)
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
                page.get_by_role("button", name="用这些记忆提问").scroll_into_view_if_needed()
                page.screenshot(path=str(output / "onboarding-partial-mobile.png"), full_page=True)
                passed("mobile_partial_receipt_and_handoff_fit_390px")
                context.close()

                page, context = new_page(onboarded=True)
                page.get_by_test_id("workspace-nav-library").click()
                library = page.locator('[data-retained-panel="library"]')
                library.get_by_role("button", name="导入", exact=True).first.click()
                started = len(all_requests)
                library.locator('input[type="file"]').set_input_files(str(chat_file))
                expect(library.locator('[data-import-outcome="partial"]')).to_contain_text("部分导入完成", timeout=30000)
                review = page.get_by_role("button", name="已核对记忆库，允许重新选择", exact=True)
                expect(review).to_be_visible()
                expect(library.locator('input[type="file"]')).to_be_disabled()
                stored = page.evaluate("() => JSON.parse(localStorage.getItem('omni-context.pending-import-jobs.v1') || '[]')")
                assert len(stored) == 1 and stored[0]["owner"] == "library" and stored[0]["kind"] == "job", stored
                assert set(stored[0]) == {"kind", "owner", "jobId", "savedAt"}, stored
                writes = [r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/import/chat"]
                assert len(writes) == 1, writes
                page.screenshot(path=str(output / "library-partial.png"), full_page=True)
                review.click()
                expect(library.locator('input[type="file"]')).to_be_enabled()
                assert len([r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/import/chat"]) == 1
                with page.expect_response(lambda r: r.url.endswith("/api/import/chat") and r.request.method == "POST"):
                    library.locator('input[type="file"]').set_input_files(str(chat_file))
                assert len([r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/import/chat"]) == 2
                passed("library_partial_import_requires_review_then_manual_reselection", write_count=2)
                context.close()

                page, context = new_page(onboarded=True)
                page.get_by_test_id("workspace-nav-library").click()
                library = page.locator('[data-retained-panel="library"]')
                library.get_by_role("button", name="导入", exact=True).first.click()
                page.route(api + "/api/ingest/job/**", lambda route: route.fulfill(
                    status=404, content_type="application/json", body='{"error":"expired fixture"}'))
                started = len(all_requests)
                library.locator('input[type="file"]').set_input_files(str(chat_file))
                acknowledgement = page.get_by_role("button", name="已核对记忆库，允许重新选择", exact=True)
                expect(acknowledgement).to_be_visible(timeout=15000)
                page.get_by_role("button", name="关闭记忆管理", exact=True).click()
                expect(library).to_be_hidden()
                page.get_by_test_id("workspace-nav-library").click()
                library.get_by_role("button", name="导入", exact=True).first.click()
                expect(acknowledgement).to_be_visible()
                expect(library.locator('input[type="file"]')).to_be_disabled()
                writes = [r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/import/chat"]
                assert len(writes) == 1, writes
                acknowledgement.click()
                expect(library.locator('input[type="file"]')).to_be_enabled()
                assert len([r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/import/chat"]) == 1
                passed("library_uncertain_write_survives_close_and_requires_explicit_review", status_read="injected fixture")
                context.close()

                page, context = new_page(width=390, height=844, onboarded=True)
                upload_trigger = page.get_by_role("button", name="上传文件", exact=True)
                upload_trigger.click()
                upload = page.locator('[data-retained-panel="upload"]')
                dialog = upload.get_by_role("dialog", name="上传文件", exact=True)
                close_dialog = dialog.get_by_role("button", name="关闭文件导入", exact=True)
                expect(close_dialog).to_be_focused()
                assert upload_trigger.evaluate("element => element.closest('[inert]') !== null")
                page.screenshot(path=str(output / "upload-modal-keyboard-mobile.png"), full_page=True)
                page.keyboard.press("Shift+Tab")
                assert dialog.evaluate("element => element.contains(document.activeElement)")
                page.keyboard.press("Tab")
                expect(close_dialog).to_be_focused()
                page.keyboard.press("Escape")
                expect(dialog).to_be_hidden()
                expect(upload_trigger).to_be_focused()
                passed("upload_modal_traps_focus_inerts_background_and_restores_trigger", viewport="390x844")
                upload_trigger.click()
                with page.expect_response(lambda r: r.url.endswith('/api/ingest/file') and r.request.method == 'POST') as submitted:
                    upload.locator('input[type="file"]').set_input_files(str(note_file))
                job_id = submitted.value.json()["jobId"]
                expect(upload.locator('li[data-status="success"]')).to_contain_text("非净新增数量", timeout=30000)
                saved_document = request(f"/api/ingest/job/{job_id}")
                assert saved_document["status"] == "success", saved_document
                assert saved_document.get("result", {}).get("archivalId"), saved_document
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
                dialog = upload.get_by_role("dialog", name="上传文件", exact=True)
                assert dialog.evaluate("""element => {
                    const bounds = element.getBoundingClientRect();
                    return bounds.x >= 0 && bounds.y >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
                }""")
                page.screenshot(path=str(output / "document-success-mobile.png"), full_page=True)
                passed("mobile_document_import_uses_real_route_and_fits_390px", status_read="real route",
                       archival_id=saved_document["result"]["archivalId"])
                context.close()

                page, context = new_page(width=390, height=844, onboarded=True, disable_web_crypto=True)
                page.get_by_role("button", name="上传文件", exact=True).click()
                upload = page.locator('[data-retained-panel="upload"]')
                writes_before = len([r for r in all_requests if r["method"] == "POST" and r["path"] == "/api/ingest/file"])
                upload.locator('input[type="file"]').set_input_files(str(note_file))
                expect(upload.get_by_role("status").filter(
                    has_text="当前客户端无法安全校验文件内容，因此没有上传。请更新桌面客户端后重试。"
                )).to_be_visible()
                writes_after = len([r for r in all_requests if r["method"] == "POST" and r["path"] == "/api/ingest/file"])
                assert writes_after == writes_before, {"before": writes_before, "after": writes_after}
                passed("webcrypto_unavailable_blocks_file_upload_before_post", status_read="controlled fixture")
                context.close()

                page, context = new_page(onboarded=True)
                page.get_by_role("button", name="上传文件", exact=True).click()
                def partial_document(route):
                    route.fulfill(status=200, content_type="application/json", body=json.dumps({
                        "jobId": urlsplit(route.request.url).path.rsplit("/", 1)[1], "status": "success",
                        "result": {"entities": 2, "relationships": 1, "chunking": {"totalChunks": 4,
                            "processedChunks": 3, "coverage": 0.75,
                            "failedChunks": [{"chunkId": "fixture-chunk", "ordinal": 1, "error": "fixture"}]}}}))
                page.route(api + "/api/ingest/job/**", partial_document)
                upload = page.locator('[data-retained-panel="upload"]')
                with page.expect_response(lambda r: r.url.endswith("/api/ingest/file") and r.request.method == "POST") as first_document:
                    upload.locator('input[type="file"]').set_input_files(str(note_file))
                first_document_job_id = first_document.value.json()["jobId"]
                expect(page.locator('li[data-status="partial"]')).to_contain_text("覆盖 75%", timeout=15000)
                expect(page.locator('li[data-status="partial"]')).to_contain_text("非净新增数量")
                expect(page.get_by_text("notes.txt 已部分导入", exact=True)).to_be_visible()
                review = upload.get_by_role("button", name="已核对记忆库，允许重新选择 notes.txt", exact=True)
                expect(review).to_be_visible()
                stored = page.evaluate("() => JSON.parse(localStorage.getItem('omni-context.pending-import-jobs.v1') || '[]')")
                assert stored == [{"kind": "job", "owner": "file-drop", "jobId": first_document_job_id,
                                   "savedAt": stored[0]["savedAt"]}], stored
                assert set(stored[0]) == {"kind", "owner", "jobId", "savedAt"}, stored
                page.screenshot(path=str(output / "document-partial-warning.png"), full_page=True)
                writes_before_review = len([r for r in all_requests if r["method"] == "POST" and r["path"] == "/api/ingest/file"])
                upload.locator('input[type="file"]').set_input_files(str(note_file))
                expect(upload.get_by_text("已忽略 1 个重复文件：已有导入任务或上传结果待确认，请先查看现有任务。", exact=True)).to_be_visible()
                assert len([r for r in all_requests if r["method"] == "POST" and r["path"] == "/api/ingest/file"]) == writes_before_review
                review.click()
                assert len([r for r in all_requests if r["method"] == "POST" and r["path"] == "/api/ingest/file"]) == writes_before_review
                with page.expect_response(lambda r: r.url.endswith("/api/ingest/file") and r.request.method == "POST"):
                    upload.locator('input[type="file"]').set_input_files(str(note_file))
                assert len([r for r in all_requests if r["method"] == "POST" and r["path"] == "/api/ingest/file"]) == writes_before_review + 1
                passed("document_partial_requires_review_then_manual_reselection", status_read="injected fixture")
                page.set_viewport_size({"width": 390, "height": 400})
                upload = page.locator('[data-retained-panel="upload"]')
                dialog = upload.get_by_role("dialog", name="上传文件", exact=True)
                assert dialog.evaluate("""element => {
                    const bounds = element.getBoundingClientRect();
                    return bounds.x >= 0 && bounds.y >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
                }""")
                assert dialog.evaluate("element => element.scrollHeight > element.clientHeight")
                partial_receipt = upload.locator('li[data-status="partial"]').first
                partial_receipt.scroll_into_view_if_needed()
                expect(partial_receipt).to_be_in_viewport()
                page.screenshot(path=str(output / "document-partial-short-window.png"), full_page=True)
                passed("short_window_upload_receipt_remains_scrollable", viewport="390x400", status_read="injected fixture")
                context.close()

                page, context = new_page(onboarded=True)
                page.get_by_role("button", name="上传文件", exact=True).click()
                upload = page.locator('[data-retained-panel="upload"]')
                page.route(api + "/api/ingest/job/**", lambda route: route.fulfill(
                    status=200, content_type="application/json", body=json.dumps({
                        "jobId": urlsplit(route.request.url).path.rsplit("/", 1)[1], "status": "cancelled"})))
                upload.locator('input[type="file"]').set_input_files(str(note_file))
                expect(upload.locator('li[data-status="cancelled"]')).to_contain_text("已保存数量暂时无法确认", timeout=15000)
                expect(upload.get_by_role("button", name="已核对记忆库，允许重新选择 notes.txt", exact=True)).to_be_visible()
                assert "已保存 0" not in upload.inner_text()
                passed("cancelled_without_counts_never_claims_zero_saved_and_requires_review", status_read="injected fixture")
                context.close()

                page, context = new_page(onboarded=True)
                page.get_by_role("button", name="上传文件", exact=True).click()
                upload = page.locator('[data-retained-panel="upload"]')
                page.route(api + "/api/ingest/job/**", lambda route: route.fulfill(
                    status=404, content_type="application/json", body='{"error":"expired fixture"}'))
                started = len(all_requests)
                upload.locator('input[type="file"]').set_input_files(str(note_file))
                review = page.get_by_role("button", name="已核对记忆库，允许重新选择 notes.txt", exact=True)
                expect(review).to_be_visible(timeout=15000)
                page.get_by_role("button", name="关闭文件导入", exact=True).click()
                expect(upload).to_be_hidden()
                page.get_by_role("button", name="上传文件", exact=True).click()
                expect(review).to_be_visible()
                upload.locator('input[type="file"]').set_input_files(str(note_file))
                expect(upload.get_by_text("已忽略 1 个重复文件：已有导入任务或上传结果待确认，请先查看现有任务。", exact=True)).to_be_visible()
                writes = [r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/ingest/file"]
                assert len(writes) == 1, writes
                review.click()
                assert len([r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/ingest/file"]) == 1
                passed("document_uncertain_write_guard_survives_close_and_repeated_selection", status_read="injected fixture")
                context.close()

                # A renderer reload restores only opaque job identity, then performs
                # a read of that same task. It must never replay the original write.
                page, context = new_page(onboarded=False, import_recoveries=[{
                    "kind": "job", "owner": "onboarding", "jobId": "recovery-onboarding-1", "savedAt": 1780272000000}])
                page.route(api + "/api/ingest/job/recovery-onboarding-1", lambda route: route.fulfill(
                    status=200, content_type="application/json", body=json.dumps({
                        "jobId": "recovery-onboarding-1", "status": "success",
                        "result": {"entities": 2, "relationships": 1}})))
                open_import(page)
                resume = page.get_by_role("button", name="继续检查原任务", exact=True)
                expect(resume).to_be_visible()
                started = len(all_requests)
                resume.click()
                expect(page.get_by_test_id("onboarding-import-receipt")).to_be_visible(timeout=15000)
                writes = [r for r in all_requests[started:] if r["method"] == "POST"
                          and r["path"] in ("/api/import/chat", "/api/ingest/file")]
                assert not writes, writes
                assert page.evaluate("localStorage.getItem('omni-context.pending-import-jobs.v1')") is None
                passed("onboarding_renderer_restart_recovers_opaque_job_without_reupload", write_count=len(writes))
                context.close()

                page, context = new_page(onboarded=True, import_recoveries=[{
                    "kind": "job", "owner": "library", "jobId": "recovery-library-1", "savedAt": 1780272000000}])
                page.route(api + "/api/ingest/job/recovery-library-1", lambda route: route.fulfill(
                    status=200, content_type="application/json", body=json.dumps({
                        "jobId": "recovery-library-1", "status": "success",
                        "result": {"entities": 1, "relationships": 0}})))
                page.get_by_test_id("workspace-nav-library").click()
                library = page.locator('[data-retained-panel="library"]')
                library.get_by_role("button", name="导入", exact=True).first.click()
                expect(library.get_by_role("button", name="继续查询任务状态", exact=True)).to_be_visible()
                started = len(all_requests)
                library.get_by_role("button", name="继续查询任务状态", exact=True).click()
                expect(library.locator('[data-import-outcome="success"]')).to_be_visible(timeout=15000)
                writes = [r for r in all_requests[started:] if r["method"] == "POST"
                          and r["path"] in ("/api/import/chat", "/api/ingest/file")]
                assert not writes, writes
                assert page.evaluate("localStorage.getItem('omni-context.pending-import-jobs.v1')") is None
                passed("library_renderer_restart_recovers_opaque_job_without_reupload", write_count=len(writes))
                context.close()

                page, context = new_page(onboarded=True)
                page.evaluate("(value) => localStorage.setItem('omni-context.pending-import-jobs.v1', value)",
                              json.dumps([{"kind": "job", "owner": "file-drop", "jobId": "recovery-file-drop-1",
                                           "savedAt": 1780272000000}]))
                page.route(api + "/api/ingest/job/recovery-file-drop-1", lambda route: route.fulfill(
                    status=200, content_type="application/json", body=json.dumps({
                        "jobId": "recovery-file-drop-1", "status": "success",
                        "result": {"entities": 1, "relationships": 0}})))
                page.reload(wait_until="domcontentloaded")
                page.wait_for_function("window.__OMNI_FIXTURE_IPC_COMMANDS__.includes('get_local_api_token')", timeout=30000)
                expect(page.get_by_test_id("workspace-navigation")).to_be_visible(timeout=30000)
                page.get_by_role("button", name="上传文件", exact=True).click()
                upload = page.locator('[data-retained-panel="upload"]')
                restored = upload.locator('li[data-status="paused"]')
                expect(restored).to_contain_text("已恢复的文件导入任务")
                expect(restored).to_contain_text("不会重新上传")
                started = len(all_requests)
                upload.get_by_role("button", name="继续查询 已恢复的文件导入任务", exact=True).click()
                expect(upload.locator('li[data-status="success"]')).to_be_visible(timeout=15000)
                writes = [r for r in all_requests[started:] if r["method"] == "POST"
                          and r["path"] in ("/api/import/chat", "/api/ingest/file")]
                assert not writes, writes
                assert page.evaluate("localStorage.getItem('omni-context.pending-import-jobs.v1')") is None
                passed("file_drop_renderer_restart_restores_task_and_queries_same_job", write_count=len(writes))
                context.close()

                page, context = new_page(onboarded=True)
                page.route(api + "/api/ingest/file", lambda route: route.abort())
                page.get_by_role("button", name="上传文件", exact=True).click()
                upload = page.locator('[data-retained-panel="upload"]')
                started = len(all_requests)
                upload.locator('input[type="file"]').set_input_files(str(note_file))
                expect(upload.get_by_role("button", name="已核对记忆库，允许重新选择 notes.txt", exact=True)).to_be_visible(timeout=15000)
                stored = page.evaluate("() => JSON.parse(localStorage.getItem('omni-context.pending-import-jobs.v1') || '[]')")
                assert len(stored) == 1 and stored[0].get("kind") == "uncertain", stored
                assert set(stored[0]) == {"kind", "owner", "attemptId", "savedAt"}, stored
                assert stored[0]["owner"] == "file-drop" and len(stored[0]["attemptId"]) <= 128, stored
                assert len([r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/ingest/file"]) == 1
                page.reload(wait_until="domcontentloaded", timeout=120000)
                page.wait_for_function("window.__OMNI_FIXTURE_IPC_COMMANDS__.includes('get_local_api_token')", timeout=60000)
                expect(page.get_by_test_id("workspace-navigation")).to_be_visible(timeout=30000)
                page.get_by_role("button", name="上传文件", exact=True).click()
                upload = page.locator('[data-retained-panel="upload"]')
                pending_review = upload.get_by_role("button", name="已核对记忆库，允许重新选择 待核对的文件导入", exact=True)
                expect(pending_review).to_be_visible()
                upload.locator('input[type="file"]').set_input_files(str(note_file))
                expect(upload.locator('p[role="status"]')).to_contain_text("检测到上次导入尚未恢复或核对")
                writes_before_review = [r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/ingest/file"]
                assert len(writes_before_review) == 1, writes_before_review
                pending_review.click()
                assert page.evaluate("localStorage.getItem('omni-context.pending-import-jobs.v1')") is None
                page.unroute(api + "/api/ingest/file")
                page.route(api + "/api/ingest/file", lambda route: route.fulfill(
                    status=200, content_type="application/json", body='{"jobId":"after-review-1"}'))
                page.route(api + "/api/ingest/job/after-review-1", lambda route: route.fulfill(
                    status=200, content_type="application/json", body=json.dumps({
                        "jobId": "after-review-1", "status": "success",
                        "result": {"entities": 1, "relationships": 0}})))
                upload.locator('input[type="file"]').set_input_files(str(note_file))
                expect(upload.locator('li[data-status="success"]')).to_be_visible(timeout=15000)
                writes = [r for r in all_requests[started:] if r["method"] == "POST" and r["path"] == "/api/ingest/file"]
                assert len(writes) == 2, writes
                passed("uncertain_file_submission_survives_renderer_restart_until_explicit_review", write_count=len(writes))
                context.close()

                assert not errors, errors
                assert not blocked, blocked
                passed("no_browser_exceptions_or_external_network")
                browser.close()
                browser = None
    except Exception as failure:
        pending_at_failure = list(pending_requests.values())
        if active_page and not active_page.is_closed():
            try:
                active_page.screenshot(path=str(output / "failure.png"), full_page=True)
                (output / "failure-dom.txt").write_text(active_page.locator("body").inner_text(), encoding="utf-8")
                environment = active_page.evaluate("""() => {
                    const saved = JSON.parse(localStorage.getItem('omnicontext-settings') || '{}');
                    return {ipc_commands: window.__OMNI_FIXTURE_IPC_COMMANDS__ || [],
                        language: localStorage.getItem('omnicontext_language'),
                        onboarded: localStorage.getItem('omni_onboarded'),
                        provider: {apiUrl: saved.llmProvider?.apiUrl, model: saved.llmProvider?.model}};
                }""")
                (output / "failure-environment.json").write_text(json.dumps(environment, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass
        results.append({"check": "journey", "status": "FAIL", "error": str(failure)})
        raise
    finally:
        for context in contexts:
            try:
                context.close()
            except Exception:
                pass
        if backend and backend.poll() is None:
            try:
                backend.stdin.write("SHUTDOWN\n")
                backend.stdin.close()
                backend.wait(timeout=10)
                backend_cleanup = {"mode": "graceful_stdin", "exit_code": backend.returncode}
            except (OSError, subprocess.TimeoutExpired):
                backend.terminate()
                try:
                    backend.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    backend.kill()
                    backend.wait(timeout=5)
                backend_cleanup = {"mode": "forced_fallback", "exit_code": backend.returncode}
        elif backend:
            backend_cleanup = {"mode": "already_exited", "exit_code": backend.returncode}
        if backend:
            try:
                closed_marker = "CLOSED" in (output / "fixture-server.log").read_text(encoding="utf-8").splitlines()
            except OSError:
                closed_marker = False
            backend_cleanup["closed_marker"] = closed_marker
            if backend_cleanup["mode"] == "graceful_stdin" and backend_cleanup["exit_code"] == 0 and closed_marker:
                passed("isolated_fixture_closes_database_listeners_and_temporary_audit", cleanup=backend_cleanup)
            else:
                cleanup_error = "Controlled fixture did not confirm clean shutdown"
                results.append({"check": "isolated_fixture_cleanup", "status": "FAIL", "error": cleanup_error,
                                "cleanup": backend_cleanup})
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if playwright:
            playwright.stop()
        (output / "import-journey-results.json").write_text(json.dumps({
            "evidence_kind": "CONTROLLED_AUTHENTICATED_HTTP_WITH_FIXTURE_AI_AND_IPC",
            "app_url": args.app_url, "api_origin": api, "model_origin": llm,
            "not_verified": ["native Tauri token IPC", "installed Windows app", "real provider inference", "real user usability"],
            "checks": results, "browser_errors": errors, "external_hosts_blocked": blocked,
            "requests": all_requests,
            "responses": responses, "pending_at_failure": pending_at_failure,
            "finished_requests": finished_requests,
            "backend_cleanup": backend_cleanup,
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    if cleanup_error:
        raise RuntimeError(cleanup_error)


if __name__ == "__main__":
    main()
