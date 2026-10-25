"""Bounded home/approval rendering checks using synthetic in-memory fixtures.

Serve the production static export on its own loopback port. Build it with
NEXT_PUBLIC_BRAIN_URL matching --api-origin. This runner starts no backend,
uses no persistent browser profile and never contacts the installed client.
This is browser rendering evidence, NOT installed Windows acceptance.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from ipaddress import ip_address
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import urlsplit

from playwright.sync_api import Error as PlaywrightError, expect, sync_playwright


TOKEN = "synthetic-home-polish-token-not-a-real-credential"
FORBIDDEN_COMMANDS = {
    "approve_pending_plan", "execute_ready_plan", "verify_pending_plan",
    "enable_cli_reopen", "reopen_decision", "capture_screen", "get_clipboard",
    "get_foreground_window_info", "capture_and_extract", "execute_hardware_action",
}
COPY = {
    "zh": {
        "title": "执行审批", "menu": "执行审批（高级）", "close": "关闭执行审批",
        "empty": "目前没有执行计划，这是正常状态", "loading": "正在读取执行计划…",
        "failed": "暂时无法读取执行计划", "retry": "重新读取", "details": "技术详情",
        "approve": "批准计划（不执行）", "run": "执行已批准的操作",
        "purpose": "这里不是个人决定记录", "personal": "记录个人决定不会授予 Agent 执行权限",
        "suggestion": "我最近在关注什么？", "mode": "2D 模式",
    },
    "en": {
        "title": "Execution approval", "menu": "Action approvals (advanced)",
        "close": "Close execution approval", "empty": "No execution plans yet — this is normal",
        "loading": "Loading execution plans…", "failed": "Execution plans are unavailable",
        "retry": "Reload plans", "details": "Technical details",
        "approve": "Approve plan (do not run)", "run": "Run approved action",
        "purpose": "This is not your personal decision journal",
        "personal": "Recording a personal decision does not grant Agent execution permission",
        "suggestion": "What have I been focusing on?", "mode": "2D Mode",
    },
}


def loopback_origin(value: str, label: str) -> str:
    parsed = urlsplit(value)
    try:
        loopback = parsed.hostname == "localhost" or ip_address(parsed.hostname or "").is_loopback
    except ValueError:
        loopback = False
    if (parsed.scheme != "http" or not loopback or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.port in (None, 3001, 3002)):
        raise ValueError(f"{label} must use an explicit isolated HTTP loopback port, not 3001/3002")
    return f"{parsed.scheme}://{parsed.netloc}"


def graph_fixture() -> dict:
    stamp = "2026-10-25T00:00:00.000Z"
    kinds = [("concept", "概念"), ("principle", "原则"), ("tool", "工具"), ("project", "项目")]
    entities = [
        {"id": f"synthetic-node-{index}", "name": f"合成{label}{index + 1}", "type": kind,
         "description": "TEST_FIXTURE：仅用于布局验收的合成资料，不是个人记忆。",
         "created_at": stamp, "updated_at": stamp, "source_file": "synthetic-fixture.txt",
         "tags": ["合成测试"], "access_count": index + 1}
        for index in range(20) for kind, label in [kinds[index % len(kinds)]]
    ]
    relationships = [
        {"id": f"synthetic-edge-{index}", "source_id": entities[index]["id"],
         "target_id": entities[(index + 1) % 20]["id"], "type": "relates_to",
         "weight": 0.7, "created_at": stamp, "valid_from": stamp}
        for index in range(20)
    ]
    return {"entities": entities, "relationships": relationships, "total": len(entities)}


def plan_fixture() -> list[dict]:
    return [
        {"plan": {"plan_id": f"synthetic-plan-{state}", "decision_id": f"synthetic-decision-{state}",
                  "capability_id": f"合成只读计划 · {label}", "state": state,
                  "required_approval": True, "approval_granted": state == "ready",
                  "risk_snapshot": {"risk_level": "low", "side_effect_class": "read_only", "reversible": True},
                  "evidence_coverage_snapshot": {"entries": []},
                  "created_at": "2026-10-25T00:00:00.000Z"}, "outcome": None}
        for state, label in [("awaiting_approval", "待批准"), ("ready", "已批准")]
    ]


def single_plan_fixture(state="awaiting_approval", verified=False) -> list[dict]:
    """One stable synthetic identity, before and after a fixture-only approval."""
    record = plan_fixture()[0]
    record["plan"].update(plan_id="synthetic-race-plan", decision_id="synthetic-race-decision",
                          capability_id="合成并发审批计划", state=state, approval_granted=state != "awaiting_approval")
    if verified:
        record["outcome"] = {"status": "VERIFIED", "revisit_required": False,
                             "readback_attempts": 1, "verification_attempts": 1}
    return [record]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:3025")
    parser.add_argument("--api-origin", default="http://127.0.0.1:4325")
    parser.add_argument("--evidence", type=Path, required=True, help="New directory; never overwritten")
    parser.add_argument("--browser-executable", type=Path,
                        default=Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"))
    args = parser.parse_args()
    ui_origin = loopback_origin(args.url, "--url")
    api_origin = loopback_origin(args.api_origin, "--api-origin")
    if urlsplit(args.api_origin).path not in ("", "/") or ui_origin == api_origin:
        raise ValueError("--api-origin must be a distinct loopback origin without a path")
    if not args.browser_executable.is_file():
        raise FileNotFoundError("Use an already installed Chromium-compatible browser; none will be downloaded")
    evidence = args.evidence.absolute()
    if evidence.exists() or evidence.is_symlink():
        raise FileExistsError("--evidence must be new; existing data will never be overwritten")
    evidence.mkdir(parents=True, exist_ok=False)
    checks, requests, blocked, unknown_api, page_errors, console_errors, native_calls = [], [], [], [], [], [], []
    pages = []
    graph = graph_fixture()
    result = {"kind": "Production frontend + real headless Edge/3D + synthetic HTTP/native IPC fixtures",
              "not_proven": ["installed Windows UI", "real data", "model quality", "actual execution permissions"],
              "ui_origin": ui_origin, "fixture_api_origin": api_origin,
              "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "timestamp": datetime.now(timezone.utc).isoformat()}
    try:
        repo = Path(__file__).resolve().parents[2]
        def git_output(*arguments: str) -> bytes:
            return subprocess.check_output(["git", *arguments], cwd=repo,
                                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

        result["source_commit"] = git_output("rev-parse", "HEAD").decode().strip()
        result["source_tree"] = git_output("rev-parse", "HEAD^{tree}").decode().strip()
        result["source_dirty"] = bool(git_output("status", "--porcelain"))
        # Hash tracked source changes without exporting their contents. New
        # untracked file contents are excluded; this runner is bound separately.
        result["tracked_diff_head_sha256"] = hashlib.sha256(
            git_output("diff", "--no-ext-diff", "--no-textconv", "HEAD", "--")
        ).hexdigest()
        result["source_identity_note"] = (
            "source_commit/source_tree identify base HEAD, not a committed fix or the exact build, "
            "when source_dirty is true. tracked_diff_head_sha256 excludes untracked file contents; "
            "script_sha256 binds this runner separately."
        )
    except (OSError, subprocess.SubprocessError):
        result["source_commit"] = None

    def check(name: str, **detail) -> None:
        checks.append({"check": name, "status": "PASS", **detail})
        print(f"PASS {name}", flush=True)

    def screenshot(page, name: str) -> None:
        page.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
        page.screenshot(path=str(evidence / f"{name}.png"), full_page=True)

    def wait_for_fixture(page, predicate, label: str) -> None:
        # A request event can arrive just before its Python route callback.
        # Pump the browser messages until the explicit fixture state changes.
        deadline = time.monotonic() + 5
        while not predicate():
            if time.monotonic() >= deadline:
                raise AssertionError(f"Timed out waiting for synthetic fixture: {label}")
            page.wait_for_timeout(20)

    def no_native_side_effects() -> None:
        fixture_approvals = [call for call in native_calls
                             if call["cmd"] == "approve_pending_plan" and call.get("synthetic") is True
                             and call.get("case") == "approval_poll_race" and call.get("permitted") is True]
        attempted = [call for call in native_calls if call["cmd"] in FORBIDDEN_COMMANDS and call not in fixture_approvals]
        assert not attempted, f"Unexpected native side-effect/capture commands: {attempted}"
        assert len(fixture_approvals) <= 1, "Only one explicit fixture-only approval is permitted in the entire run"

    def init_script(language: str, allow_fixture_approval=False) -> str:
        # All callbacks stay in this disposable browser. This function has no
        # transport to Tauri, localhost native bridges or the real OS clipboard.
        settings = {"behavior": {"onboarded": True, "onboarded_v2": True, "capturePaused": True,
                                 "captureBlocklist": ["SyntheticSensitiveApp"], "autoHUD": False},
                    "llmProvider": {"apiUrl": api_origin + "/never-a-real-model", "apiKey": "", "model": "synthetic-no-model"}}
        return """(() => {
          localStorage.setItem('omnicontext_language', LANGUAGE);
          localStorage.setItem('omnicontext-settings', JSON.stringify(SETTINGS));
          localStorage.setItem('omni_onboarded', 'true');
          localStorage.setItem('omni_onboarded_v2', 'true');
          window.__OMNI_TEST_IPC__ = [];
          window.__OMNI_TEST_BLOCKED_TRANSPORTS__ = [];
          window.__OMNI_TEST_APPROVAL_COUNT__ = 0;
          window.__TAURI_METADATA__ = {__currentWindow:{label:'main'},__windows:[{label:'main'}]};
          let generation = 0;
          window.__TAURI_IPC__ = m => {
            const call = {cmd:m.cmd, synthetic:true};
            window.__OMNI_TEST_IPC__.push(call);
            let value = null, error = null;
            if (m.cmd === 'get_local_api_token') value = TOKEN;
            else if (m.cmd === 'invalidate_capture_policy') value = ++generation;
            else if (m.cmd === 'sync_capture_policy') {
              if (m.expectedGeneration !== generation || m.capturePaused !== true) error = 'Synthetic fixture only accepts paused capture';
            } else if (m.cmd === 'load_import_recovery') value = '[]';
            else if (m.cmd === 'get_pending_import_jobs') value = [];
            else if (m.cmd === 'get_mcp_clients_status') value = {};
            else if (m.cmd === 'get_system_status') value = {brain_server_running:true,udp_listener_running:false,last_event:null};
            else if (m.cmd === 'set_close_behavior' || m.cmd === 'register_global_shortcuts') value = null;
            else if (m.cmd === 'tauri') value = m.message?.cmd === 'listen' ? 1 : null;
            else if (m.cmd === 'approve_pending_plan' && ALLOW_FIXTURE_APPROVAL === true
                     && m.planId === 'synthetic-race-plan' && window.__OMNI_TEST_APPROVAL_COUNT__ === 0) {
              window.__OMNI_TEST_APPROVAL_COUNT__ += 1;
              call.case = 'approval_poll_race';
              call.permitted = true;
              window.__OMNI_TEST_RESOLVE_APPROVAL__ = () => {
                const callback = window['_' + m.callback];
                delete window.__OMNI_TEST_RESOLVE_APPROVAL__;
                queueMicrotask(() => callback?.({synthetic:true,approved:true,executed:false}));
              };
              return;
            }
            else error = 'Native command denied by synthetic-only fixture';
            queueMicrotask(() => window['_' + (error ? m.error : m.callback)]?.(error || value));
          };
          for (const name of ['WebSocket', 'Worker', 'SharedWorker', 'EventSource']) {
            if (name in window) window[name] = class {
              constructor() {
                window.__OMNI_TEST_BLOCKED_TRANSPORTS__.push(name);
                throw new Error(name + ' is disabled in the isolated layout fixture');
              }
            };
          }
        })();""".replace("LANGUAGE", json.dumps(language)).replace("SETTINGS", json.dumps(settings)).replace("TOKEN", json.dumps(TOKEN)).replace("ALLOW_FIXTURE_APPROVAL", json.dumps(allow_fixture_approval))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True, executable_path=str(args.browser_executable),
            args=["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run"],
        )
        contexts = []
        try:
            def new_page(width=1440, height=900, language="zh", mode="empty", allow_fixture_approval=False):
                context = browser.new_context(viewport={"width": width, "height": height},
                                              locale="zh-CN" if language == "zh" else "en-US",
                                              reduced_motion="reduce", service_workers="block")
                contexts.append(context)
                state = {"mode": mode, "held": [], "plan_reads": 0, "race_approved": False}
                context.add_init_script(init_script(language, allow_fixture_approval))
                if hasattr(context, "route_web_socket"):
                    def reject_websocket(socket):
                        blocked.append({"kind": "websocket", "url": socket.url})
                        socket.close(code=1008, reason="Synthetic-only rendering fixture")
                    context.route_web_socket("**/*", reject_websocket)

                def fulfill(route, payload, status=200):
                    route.fulfill(status=status, content_type="application/json", body=json.dumps(payload, ensure_ascii=False),
                                  headers={"Access-Control-Allow-Origin": ui_origin,
                                           "Access-Control-Allow-Headers": "Content-Type, Authorization",
                                           "Access-Control-Allow-Methods": "GET, POST, OPTIONS"})

                def guard(route):
                    request = route.request
                    parsed = urlsplit(request.url)
                    origin = f"{parsed.scheme}://{parsed.netloc}"
                    if origin == ui_origin and request.method in ("GET", "HEAD") and not parsed.path.startswith(("/api/", "/mcp", "/health")):
                        route.continue_()
                        return
                    requests.append({"method": request.method, "origin": origin, "path": parsed.path})
                    if origin != api_origin:
                        blocked.append({"kind": "http", "method": request.method, "url": request.url})
                        route.abort("blockedbyclient")
                        return
                    if request.method == "OPTIONS":
                        fulfill(route, {})
                    elif parsed.path == "/health" and request.method == "GET":
                        fulfill(route, {"status": "ok", "fixture": True})
                    elif parsed.path == "/api/graph/context" and request.method == "POST":
                        fulfill(route, graph)
                    elif parsed.path == "/api/notifications" and request.method == "GET":
                        fulfill(route, [])
                    elif parsed.path == "/api/settings/llm" and request.method == "POST":
                        fulfill(route, {"success": True, "fixture": True})
                    elif parsed.path == "/api/discussions" and request.method == "GET":
                        fulfill(route, [])
                    elif parsed.path == "/api/control/plans" and request.method == "GET":
                        state["plan_reads"] += 1
                        if state["mode"] == "loading":
                            state["held"].append(route)
                        elif state["mode"] == "error":
                            fulfill(route, {"error": "SYNTHETIC_SERVICE_UNAVAILABLE"}, 503)
                        elif state["mode"] == "invalid":
                            fulfill(route, {"plans": [{"not_a_plan": True}]})
                        elif state["mode"] == "approval_race":
                            if state["plan_reads"] == 2:
                                # Capture the pre-approval poll and deliberately
                                # leave its response pending across the IPC receipt.
                                state["held"].append(route)
                            else:
                                fulfill(route, {"plans": single_plan_fixture("ready" if state["race_approved"] else "awaiting_approval")})
                        elif state["mode"] == "verified":
                            fulfill(route, {"plans": single_plan_fixture("succeeded", verified=True)})
                        else:
                            fulfill(route, {"plans": plan_fixture() if state["mode"] == "plans" else []})
                    else:
                        unknown_api.append({"method": request.method, "path": parsed.path})
                        fulfill(route, {"error": "UNKNOWN_SYNTHETIC_ENDPOINT"}, 503)

                context.route("**/*", guard)
                page = context.new_page()
                pages.append(page)
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
                page.goto(args.url, wait_until="networkidle", timeout=60000)
                expect(page.get_by_test_id("workspace-navigation")).to_be_visible(timeout=30000)
                expect(page.get_by_test_id("startup-splash")).to_be_hidden(timeout=15000)
                expect(page.get_by_test_id("capture-policy-sync-alert")).to_be_hidden()
                return page, context, state

            def collect_native(page):
                native_calls.extend(page.evaluate("window.__OMNI_TEST_IPC__ || []"))
                transports = page.evaluate("window.__OMNI_TEST_BLOCKED_TRANSPORTS__ || []")
                blocked.extend({"kind": "blocked-constructor", "name": name} for name in transports)

            def open_approvals(page, language="zh"):
                copy = COPY[language]
                page.get_by_test_id("header-more-menu").click()
                page.get_by_role("button", name=copy["menu"], exact=True).click()
                dialog = page.get_by_role("dialog", name=copy["title"], exact=True)
                expect(dialog).to_be_visible()
                return dialog

            def empty_assertions(dialog, language="zh"):
                copy = COPY[language]
                expect(dialog.get_by_role("heading", name=copy["empty"], exact=True)).to_be_visible()
                expect(dialog).to_contain_text(copy["purpose"])
                expect(dialog).to_contain_text(copy["personal"])
                expect(dialog.get_by_role("button", name=copy["approve"], exact=True)).to_have_count(0)
                expect(dialog.get_by_role("button", name=copy["run"], exact=True)).to_have_count(0)

            for width, height in [(1440, 900), (1024, 640), (390, 700)]:
                page, context, _ = new_page(width, height)
                expect(page.get_by_test_id("ask-first-empty-state")).to_have_count(0)
                field = page.get_by_test_id("ask-primary-input")
                expect(field).to_be_visible()
                box = field.bounding_box()
                assert box and box["width"] >= 60 and box["height"] > 0, box
                assert box["x"] >= 0 and box["x"] + box["width"] <= width + 1, box
                hit = field.evaluate("el => { const r=el.getBoundingClientRect(); return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2) === el; }")
                assert hit, f"Ask input is covered at {width}x{height}"
                expect(page.locator(".omni-graph-view canvas").first).to_be_visible(timeout=30000)
                expect(page.get_by_test_id("graph-engine-error")).to_have_count(0)
                expect(page.get_by_test_id("graph-engine-loading")).to_have_count(0)
                expect(page.get_by_role("button", name=COPY["zh"]["mode"], exact=True)).to_be_visible()
                # Hidden or unmounted is acceptable; never display the English
                # library instructions above the production canvas.
                for info in page.locator(".omni-graph-view .scene-nav-info").all():
                    expect(info).to_be_hidden()
                assert "Left-click: rotate" not in page.locator("body").inner_text()
                tooltips = page.locator(".omni-graph-view .float-tooltip-kap")
                expect(tooltips.first).to_be_attached(timeout=15000)
                assert all(tip.evaluate("el => getComputedStyle(el).position") == "absolute" for tip in tooltips.all())
                canvas = page.locator(".omni-graph-view canvas").first
                assert canvas.evaluate("el => el.width > 0 && el.height > 0 && (!!el.getContext('webgl2') || !!el.getContext('webgl'))"), "Real 3D WebGL canvas unavailable"
                if width >= 1024:
                    for label in ["概念", "原则", "工具", "项目"]:
                        expect(page.locator(".omni-graph-view aside").get_by_text(label, exact=True)).to_be_visible()
                    for raw in ["concept", "principle", "tool", "project"]:
                        expect(page.get_by_text(raw, exact=True)).to_have_count(0)
                screenshot(page, f"home-zh-{width}x{height}")
                field.click()
                expect(field).to_be_focused()
                suggestion = page.get_by_role("button", name=COPY["zh"]["suggestion"], exact=True)
                expect(suggestion).to_be_visible()
                # Trial click checks hit testing without silently submitting a
                # suggested personal question or opening a model connection.
                suggestion.click(trial=True)
                screenshot(page, f"home-suggestions-zh-{width}x{height}")
                check(f"home_{width}x{height}_unobstructed_real_3d_and_suggestions")
                field.press("Tab")
                dialog = open_approvals(page)
                empty_assertions(dialog)
                bounds = dialog.bounding_box()
                assert bounds and bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= width + 1, bounds
                assert dialog.evaluate("el => el.scrollWidth <= el.clientWidth + 1"), "Approval panel overflows horizontally"
                screenshot(page, f"approval-empty-zh-{width}x{height}")
                collect_native(page)
                no_native_side_effects()
                check(f"approval_empty_{width}x{height}_explains_purpose_without_side_effects")
                context.close()

            page, context, state = new_page(mode="loading")
            dialog = open_approvals(page)
            expect(dialog.get_by_role("status")).to_have_text(COPY["zh"]["loading"])
            expect(dialog.get_by_role("heading", name=COPY["zh"]["empty"], exact=True)).to_have_count(0)
            screenshot(page, "approval-loading-zh")
            check("approval_loading_never_claims_empty")
            assert state["held"], "No synthetic held request observed"
            for route in state["held"]:
                route.fulfill(status=503, content_type="application/json", body='{"error":"SYNTHETIC_SERVICE_UNAVAILABLE"}',
                              headers={"Access-Control-Allow-Origin": ui_origin})
            state["held"].clear()
            state["mode"] = "error"
            expect(dialog.get_by_role("alert")).to_contain_text(COPY["zh"]["failed"])
            expect(dialog.get_by_role("heading", name=COPY["zh"]["empty"], exact=True)).to_have_count(0)
            expect(dialog.get_by_role("button", name=COPY["zh"]["retry"], exact=True)).to_be_enabled()
            screenshot(page, "approval-unavailable-zh")
            check("approval_503_is_not_empty_and_has_explicit_retry")
            state["mode"] = "invalid"
            dialog.get_by_role("button", name=COPY["zh"]["retry"], exact=True).click()
            dialog.get_by_text(COPY["zh"]["details"], exact=True).click()
            expect(dialog.get_by_role("alert")).to_contain_text("CONTROL_PLANS_RESPONSE_INVALID")
            expect(dialog.get_by_role("heading", name=COPY["zh"]["empty"], exact=True)).to_have_count(0)
            screenshot(page, "approval-invalid-response-zh")
            check("approval_malformed_records_never_masquerade_as_empty")
            state["mode"] = "empty"
            dialog.get_by_role("button", name=COPY["zh"]["retry"], exact=True).click()
            empty_assertions(dialog)
            expect(dialog.get_by_role("alert")).to_have_count(0)
            check("approval_explicit_retry_recovers_valid_empty_queue")
            collect_native(page)
            no_native_side_effects()
            context.close()

            page, context, _ = new_page(mode="plans")
            dialog = open_approvals(page)
            pending = dialog.locator("article").filter(has_text="synthetic-plan-awaiting_approval")
            ready = dialog.locator("article").filter(has_text="synthetic-plan-ready")
            expect(pending.get_by_role("button", name=COPY["zh"]["approve"], exact=True)).to_be_enabled()
            expect(pending.get_by_role("button", name=COPY["zh"]["run"], exact=True)).to_have_count(0)
            expect(ready.get_by_role("button", name=COPY["zh"]["run"], exact=True)).to_be_enabled()
            expect(ready.get_by_role("button", name=COPY["zh"]["approve"], exact=True)).to_have_count(0)
            expect(pending).to_contain_text("批准只会使计划进入待执行状态，不会自动开始执行")
            screenshot(page, "approval-pending-and-ready-zh")
            collect_native(page)
            no_native_side_effects()
            check("approval_pending_and_ready_preserve_separate_explicit_actions")
            context.close()

            page, context, state = new_page(mode="approval_race", allow_fixture_approval=True)
            # Install the deterministic clock before ControlCenter creates its
            # poll timer. No host clock, native timer or installed app is changed.
            page.clock.install()
            dialog = open_approvals(page)
            race_record = dialog.locator("article").filter(has_text="synthetic-race-plan")
            approval = race_record.get_by_role("button", name=COPY["zh"]["approve"], exact=True)
            expect(approval).to_be_enabled()
            approval.click()
            page.wait_for_function("typeof window.__OMNI_TEST_RESOLVE_APPROVAL__ === 'function'")
            with page.expect_request(lambda request: request.method == "GET" and request.url == api_origin + "/api/control/plans"):
                page.clock.fast_forward(5001)
            wait_for_fixture(page, lambda: state["plan_reads"] == 2 and len(state["held"]) == 1, "held pre-approval poll")
            assert state["plan_reads"] == 2 and len(state["held"]) == 1, "Expected one held pre-approval poll"
            old_poll = state["held"][0]
            state["race_approved"] = True
            # The receipt must start a replacement read while the old poll has
            # not delivered its stale awaiting_approval snapshot. The previous
            # implementation silently skipped refresh here and fails this wait.
            with page.expect_request(lambda request: request.method == "GET" and request.url == api_origin + "/api/control/plans", timeout=5000):
                page.evaluate("window.__OMNI_TEST_RESOLVE_APPROVAL__()")
            expect(race_record.get_by_role("button", name=COPY["zh"]["run"], exact=True)).to_be_enabled()
            expect(race_record.get_by_role("button", name=COPY["zh"]["approve"], exact=True)).to_have_count(0)
            assert state["plan_reads"] >= 3, "Approval did not replace the in-flight read"
            # If Chromium has already confirmed abort, the old response cannot
            # be delivered. Otherwise deliver the stale snapshot last, then
            # prove it cannot restore a stale approval action.
            stale_delivery = "cancelled_before_response" if old_poll.request.failure else "delivered_after_fresh_read"
            if not old_poll.request.failure:
                try:
                    old_poll.fulfill(status=200, content_type="application/json",
                                     body=json.dumps({"plans": single_plan_fixture()}),
                                     headers={"Access-Control-Allow-Origin": ui_origin})
                except PlaywrightError:
                    if not old_poll.request.failure:
                        raise
                    stale_delivery = "cancelled_before_response"
            page.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
            expect(race_record.get_by_role("button", name=COPY["zh"]["run"], exact=True)).to_be_enabled()
            expect(race_record.get_by_role("button", name=COPY["zh"]["approve"], exact=True)).to_have_count(0)
            screenshot(page, "approval-receipt-replaces-old-poll-zh")
            collect_native(page)
            no_native_side_effects()
            check("approval_receipt_replaces_inflight_poll_and_cannot_restore_stale_buttons",
                  synthetic=True, explicit_fixture_approvals=1, plan_reads=state["plan_reads"], stale_delivery=stale_delivery)
            context.close()

            page, context, _ = new_page(mode="verified")
            dialog = open_approvals(page)
            dialog.get_by_role("button", name="重新考虑判断", exact=True).click()
            confirmation = page.get_by_role("dialog", name="确认重新评估", exact=True)
            expect(confirmation).to_be_visible()
            expect(confirmation).to_contain_text("不会开始执行、重试或回滚")
            reason = confirmation.get_by_label("你的理由 （已核验结果必须填写）", exact=True)
            create = confirmation.get_by_role("button", name="创建新判断（不执行）", exact=True)
            expect(create).to_be_disabled()
            reason.fill("   ")
            expect(create).to_be_disabled()
            reason.fill("合成验收理由：出现新的合成证据，需要重新考虑，但本次不提交。")
            expect(create).to_be_enabled()
            screenshot(page, "approval-verified-reconsider-requires-reason-zh")
            # Opening/inspecting a confirmation is not authorization to mint a
            # reopen session or create a judgment. Never click the create action.
            confirmation.get_by_role("button", name="取消", exact=True).click()
            expect(confirmation).to_have_count(0)
            collect_native(page)
            no_native_side_effects()
            check("verified_reconsider_requires_nonblank_owner_reason_without_any_reopen_execution")
            context.close()

            page, context, _ = new_page(language="en")
            expect(page.get_by_test_id("ask-first-empty-state")).to_have_count(0)
            dialog = open_approvals(page, "en")
            empty_assertions(dialog, "en")
            expect(dialog).not_to_contain_text("执行审批")
            expect(dialog).not_to_contain_text("Decision Control Center")
            screenshot(page, "approval-empty-en-1440x900")
            collect_native(page)
            no_native_side_effects()
            check("english_surface_uses_consistent_execution_approval_copy")
            context.close()

            assert not blocked, f"Unexpected forbidden-origin/worker/socket attempts: {blocked}"
            assert not unknown_api, f"Unexpected synthetic API paths: {unknown_api}"
            assert not page_errors, f"Uncaught UI errors: {page_errors}"
            approvals = [call for call in native_calls if call["cmd"] == "approve_pending_plan"]
            assert len(approvals) == 1 and approvals[0].get("synthetic") is True and approvals[0].get("permitted") is True
            check("no_external_real_brain_native_capture_or_execution_requests",
                  intercepted_api_requests=len(requests), native_fixture_calls=len(native_calls),
                  synthetic_approval_count=len(approvals), real_native_actions=0)
            result["status"] = "CONTROLLED_RENDERING_PASS"
        except Exception as error:
            result.update(status="FAIL", error=str(error))
            for page in reversed(pages):
                if not page.is_closed():
                    try:
                        screenshot(page, "failure")
                        collect_native(page)
                    except Exception:
                        pass
                    break
            raise
        finally:
            result.update(checks=checks, requests=requests, blocked_requests=blocked, unknown_api=unknown_api,
                          page_errors=page_errors, console_errors=console_errors, native_fixture_calls=native_calls)
            (evidence / "home-polish-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            for context in contexts:
                try:
                    context.close()
                except Exception:
                    pass
            browser.close()


if __name__ == "__main__":
    main()
