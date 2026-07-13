#!/usr/bin/env python3
"""Run the Windows Conversation 1 interruption/resume/retry acceptance flow.

This controller never reads or logs API credentials. The caller must provide the
normal benchmark environment variables. Requests are forwarded through a local
loopback proxy so one bounded Judge outage can be injected after the real SIGINT
resume, then repaired through the production retry-errors CLI.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def latest_records(results_path: Path) -> tuple[dict[str, dict], list[dict]]:
    records: list[dict] = []
    if results_path.exists():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                records.append(json.loads(line))
    latest: dict[str, dict] = {}
    for record in records:
        latest[str(record["question_id"])] = record
    return latest, records


class ProxyState:
    def __init__(self, upstream: str, event_log: Path):
        self.upstream = upstream.rstrip("/")
        self.event_log = event_log
        self.lock = threading.Lock()
        self.ordinals: dict[str, int] = {}
        self.fail_judge_remaining = 0

    def classify(self, body: bytes) -> str:
        try:
            payload = json.loads(body.decode("utf-8"))
            messages = payload.get("messages", [])
            system = "\n".join(
                str(item.get("content", ""))
                for item in messages
                if item.get("role") == "system"
            )
        except Exception:
            return "unknown"
        if "You evaluate a structured candidate answer" in system:
            return "judge"
        if "You are answering a question about a conversation" in system:
            return "answer"
        if "information extractor for a knowledge graph" in system:
            return "extraction"
        return "health_or_other"

    def next_request(self, kind: str) -> tuple[int, bool]:
        with self.lock:
            ordinal = self.ordinals.get(kind, 0) + 1
            self.ordinals[kind] = ordinal
            forced = kind == "judge" and self.fail_judge_remaining > 0
            if forced:
                self.fail_judge_remaining -= 1
            return ordinal, forced

    def arm_judge_outage(self, failures: int) -> None:
        with self.lock:
            self.fail_judge_remaining = failures

    def log(self, event: dict) -> None:
        with self.lock:
            with self.event_log.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(event, ensure_ascii=False) + "\n")


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def make_proxy_handler(state: ProxyState):
    class ProxyHandler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, _format: str, *_args) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            self.forward(b"", "health_or_other")

        def do_POST(self) -> None:  # noqa: N802
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            self.forward(body, state.classify(body))

        def forward(self, body: bytes, kind: str) -> None:
            ordinal, forced = state.next_request(kind)
            started = time.monotonic()
            if forced:
                payload = json.dumps({"error": {"message": "controlled judge outage for retry acceptance"}}).encode()
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                state.log({
                    "at": utc_now(), "kind": kind, "ordinal": ordinal,
                    "forced_outage": True, "status": 503,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                })
                return

            url = state.upstream + self.path
            headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
            authorization = self.headers.get("Authorization")
            if authorization:
                headers["Authorization"] = authorization
            request = urllib.request.Request(
                url, data=body if self.command != "GET" else None,
                headers=headers, method=self.command,
            )
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    response_body = response.read()
                    status = response.status
                    content_type = response.headers.get("Content-Type", "application/json")
            except urllib.error.HTTPError as error:
                response_body = error.read()
                status = error.code
                content_type = error.headers.get("Content-Type", "application/json")
            except Exception as error:
                response_body = json.dumps({"error": {"message": f"proxy upstream failure: {type(error).__name__}"}}).encode()
                status = 502
                content_type = "application/json"

            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            client_disconnected = False
            try:
                self.wfile.write(response_body)
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                # The benchmark intentionally aborts timed-out provider calls.
                # Preserve the upstream result as an event without a noisy
                # request-thread traceback or any response-body logging.
                client_disconnected = True
            state.log({
                "at": utc_now(), "kind": kind, "ordinal": ordinal,
                "forced_outage": False, "status": status,
                "client_disconnected": client_disconnected,
                "duration_ms": round((time.monotonic() - started) * 1000),
            })

    return ProxyHandler


def hidden_console_startup() -> subprocess.STARTUPINFO:
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    return startup


def start_cli(command: list[str], cwd: Path, env: dict[str, str], log_path: Path) -> tuple[subprocess.Popen, object]:
    log_handle = log_path.open("w", encoding="utf-8")
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
        startupinfo=hidden_console_startup(),
        text=True,
    )
    return process, log_handle


def wait_process(process: subprocess.Popen, log_handle, timeout: float | None = None) -> int:
    try:
        return process.wait(timeout=timeout)
    finally:
        log_handle.close()


def send_real_sigint(process: subprocess.Popen) -> None:
    kernel32 = ctypes.windll.kernel32
    kernel32.FreeConsole()
    if not kernel32.AttachConsole(process.pid):
        raise RuntimeError(f"AttachConsole failed for PID {process.pid}")
    if not kernel32.SetConsoleCtrlHandler(None, True):
        raise RuntimeError("Unable to make the controller ignore CTRL_C_EVENT")
    if not kernel32.GenerateConsoleCtrlEvent(0, 0):
        raise RuntimeError("GenerateConsoleCtrlEvent(CTRL_C_EVENT) failed")


def discover_new_run(runs_root: Path, baseline: set[Path], timeout: float = 300) -> Path:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for candidate in runs_root.iterdir():
            if candidate.is_dir() and candidate not in baseline and (candidate / "manifest.json").exists():
                return candidate
        time.sleep(0.2)
    raise TimeoutError("Timed out waiting for the benchmark run directory")


def wait_for_completed(results_path: Path, count: int, process: subprocess.Popen, timeout: float = 7200) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        latest, _ = latest_records(results_path)
        completed = sum(record.get("status") == "completed" for record in latest.values())
        if completed >= count:
            return completed
        if process.poll() is not None:
            raise RuntimeError(f"Benchmark exited before {count} completed questions (exit={process.returncode})")
        time.sleep(0.2)
    raise TimeoutError(f"Timed out waiting for {count} completed questions")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--runs-root", required=True, type=Path)
    parser.add_argument("--brain-server-root", required=True, type=Path)
    parser.add_argument("--node", default="node")
    parser.add_argument("--interrupt-after", type=int, default=3)
    parser.add_argument("--forced-judge-failures", type=int, default=4)
    args = parser.parse_args()

    if os.name != "nt":
        raise RuntimeError("This acceptance controller is specifically for the Windows CTRL_C_EVENT path")
    upstream = os.environ.get("LLM_API_URL", "").rstrip("/")
    if not upstream or upstream.startswith("http://127.0.0.1"):
        raise RuntimeError("LLM_API_URL must contain the real upstream API base URL")
    for name in ("LLM_API_KEY", "LLM_MODEL"):
        if not os.environ.get(name):
            raise RuntimeError(f"{name} is required")

    benchmark_root = Path(__file__).resolve().parents[1]
    args.runs_root.mkdir(parents=True, exist_ok=True)
    controller_dir = args.runs_root / ("_controller-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    controller_dir.mkdir(parents=True, exist_ok=False)
    proxy_events = controller_dir / "provider-proxy-events.jsonl"

    proxy_state = ProxyState(upstream, proxy_events)
    proxy = ThreadingHTTPServer(("127.0.0.1", 0), make_proxy_handler(proxy_state))
    proxy_thread = threading.Thread(target=proxy.serve_forever, daemon=True)
    proxy_thread.start()

    local_url = f"http://127.0.0.1:{proxy.server_port}"
    child_env = dict(os.environ)
    child_env["LLM_API_URL"] = local_url
    child_env["JUDGE_API_URL"] = local_url
    child_env["OMNI_EVAL_ROOT"] = str(args.runs_root.parent)
    base_args = [
        args.node, "src/cli.mjs",
        "--dataset", str(args.dataset.resolve()),
        "--brain-server-root", str(args.brain_server_root.resolve()),
        "--runs", str(args.runs_root.resolve()),
    ]

    baseline = {item for item in args.runs_root.iterdir() if item.is_dir() and (item / "manifest.json").exists()}
    summary: dict = {
        "started_at": utc_now(),
        "dataset_sha256": sha256_file(args.dataset),
        "interrupt_after_completed": args.interrupt_after,
        "forced_judge_failures": args.forced_judge_failures,
    }

    try:
        initial_log = controller_dir / "runner.log"
        process, handle = start_cli(base_args[:2] + ["dev"] + base_args[2:], benchmark_root, child_env, initial_log)
        run_dir = discover_new_run(args.runs_root, baseline)
        results_path = run_dir / "conversation-1" / "results.jsonl"
        observed_completed = wait_for_completed(results_path, args.interrupt_after, process)
        summary["completed_before_signal_observed"] = observed_completed
        summary["sigint_sent_at"] = utc_now()
        send_real_sigint(process)
        initial_exit = wait_process(process, handle, timeout=600)
        summary["initial_exit_code"] = initial_exit

        manifest = read_json(run_dir / "manifest.json")
        interrupted_latest, interrupted_records = latest_records(results_path)
        interrupted_completed = sum(record.get("status") == "completed" for record in interrupted_latest.values())
        if manifest.get("status") != "interrupted":
            raise RuntimeError(f"Expected interrupted manifest, got {manifest.get('status')}")
        if interrupted_completed < args.interrupt_after:
            raise RuntimeError("Completed records were lost during SIGINT")
        summary["manifest_after_sigint"] = manifest.get("status")
        summary["completed_after_sigint"] = interrupted_completed
        summary["records_after_sigint"] = len(interrupted_records)
        shutil.copy2(results_path, controller_dir / "results-after-sigint.jsonl")

        proxy_state.arm_judge_outage(args.forced_judge_failures)
        resume_log = controller_dir / "resume.log"
        process, handle = start_cli(base_args[:2] + ["resume", "--run-id", manifest["run_id"]] + base_args[2:], benchmark_root, child_env, resume_log)
        resume_exit = wait_process(process, handle)
        summary["resume_exit_code"] = resume_exit
        if resume_exit != 0:
            raise RuntimeError(f"Resume CLI failed with exit {resume_exit}")

        resumed_manifest = read_json(run_dir / "manifest.json")
        resumed_latest, resumed_records = latest_records(results_path)
        resumed_errors = sum(record.get("status") == "error" for record in resumed_latest.values())
        resumed_completed = sum(record.get("status") == "completed" for record in resumed_latest.values())
        if resumed_errors < 1:
            raise RuntimeError("Controlled Judge outage did not produce a retryable error")
        summary["manifest_after_resume"] = resumed_manifest.get("status")
        summary["completed_after_resume"] = resumed_completed
        summary["errors_after_resume"] = resumed_errors
        summary["records_after_resume"] = len(resumed_records)
        shutil.copy2(results_path, controller_dir / "results-before-retry-errors.jsonl")

        proxy_state.arm_judge_outage(0)
        retry_log = controller_dir / "retry-errors.log"
        process, handle = start_cli(base_args[:2] + ["retry-errors", "--run-id", manifest["run_id"]] + base_args[2:], benchmark_root, child_env, retry_log)
        retry_exit = wait_process(process, handle)
        summary["retry_errors_exit_code"] = retry_exit
        if retry_exit != 0:
            raise RuntimeError(f"retry-errors CLI failed with exit {retry_exit}")

        final_manifest = read_json(run_dir / "manifest.json")
        final_latest, final_records = latest_records(results_path)
        final_completed = sum(record.get("status") == "completed" for record in final_latest.values())
        final_errors = sum(record.get("status") == "error" for record in final_latest.values())
        completed_counts: dict[str, int] = {}
        for record in final_records:
            if record.get("status") == "completed":
                qid = str(record["question_id"])
                completed_counts[qid] = completed_counts.get(qid, 0) + 1
        duplicate_completed = sum(count > 1 for count in completed_counts.values())
        expected = int(final_manifest.get("statistics", {}).get("expected_questions", 0))
        if final_manifest.get("status") != "completed" or final_completed != expected or final_errors != 0:
            raise RuntimeError(
                f"Final run incomplete: status={final_manifest.get('status')} completed={final_completed} expected={expected} errors={final_errors}"
            )
        if duplicate_completed:
            raise RuntimeError(f"Found {duplicate_completed} duplicate completed question IDs")

        summary.update({
            "run_id": final_manifest["run_id"],
            "run_directory_name": run_dir.name,
            "final_manifest_status": final_manifest.get("status"),
            "expected_questions": expected,
            "completed_questions": final_completed,
            "error_questions": final_errors,
            "retry_records": sum(record.get("status") == "retry" for record in final_records),
            "duplicate_completed_question_ids": duplicate_completed,
            "final_record_count": len(final_records),
            "completed_at": utc_now(),
        })
        (controller_dir / "acceptance-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for name in ("runner.log", "resume.log", "retry-errors.log", "provider-proxy-events.jsonl", "results-after-sigint.jsonl", "results-before-retry-errors.jsonl", "acceptance-summary.json"):
            shutil.copy2(controller_dir / name, run_dir / name)
        print(json.dumps({
            "status": "passed", "run_id": final_manifest["run_id"],
            "run_dir": str(run_dir), "expected": expected,
            "completed": final_completed, "errors": final_errors,
            "retry_records": summary["retry_records"],
        }, ensure_ascii=False, indent=2))
        return 0
    finally:
        proxy.shutdown()
        proxy.server_close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"status": "failed", "error_type": type(error).__name__, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise
