"""Headless visual-only smoke for the static Alpha UI; not installed-client evidence."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect


def sha256_directory(directory: Path) -> str | None:
    if not directory.is_dir():
        return None
    digest = hashlib.sha256()
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        digest.update(path.relative_to(directory).as_posix().encode("utf-8"))
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
    return digest.hexdigest()


def evidence_metadata(root: Path) -> dict[str, object]:
    def git(*args: str) -> bytes:
        return subprocess.run(
            ["git", *args], cwd=root, check=True, capture_output=True,
        ).stdout

    status = git("status", "--porcelain=v1", "--untracked-files=all")
    diff = git("diff", "--binary", "HEAD")
    diff_digest = hashlib.sha256()
    diff_digest.update(diff)
    for raw_path in sorted(path for path in git("ls-files", "--others", "--exclude-standard", "-z").split(b"\0") if path):
        relative = Path(raw_path.decode("utf-8", errors="surrogateescape"))
        source_path = root / relative
        if source_path.is_file():
            diff_digest.update(b"\0UNTRACKED\0")
            diff_digest.update(raw_path)
            with source_path.open("rb") as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    diff_digest.update(block)

    return {
        "git_head": git("rev-parse", "HEAD").decode().strip(),
        "git_branch": git("branch", "--show-current").decode().strip(),
        "source_worktree_clean": not bool(status.strip()),
        "source_worktree_diff_sha256": diff_digest.hexdigest(),
        "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "desktop_bundle_sha256": sha256_directory(root / "desktop-daemon" / "out"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--browser-executable", type=Path)
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")
    host = urlparse(base_url).hostname
    if host not in ("127.0.0.1", "localhost"):
        parser.error("The visual smoke may only open a loopback URL")
    if args.browser_executable and not args.browser_executable.is_file():
        parser.error("The supplied browser executable does not exist")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    root = Path(__file__).resolve().parents[2]
    results: dict[str, object] = {
        "status": "PASS", "scope": "headless static UI only", "checks": [],
        **evidence_metadata(root),
    }
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=str(args.browser_executable) if args.browser_executable else None,
        )
        context = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
        context.add_init_script("localStorage.setItem('omnicontext_language', 'zh');")
        page = context.new_page()
        external: list[str] = []

        def network_guard(route) -> None:
            hostname = urlparse(route.request.url).hostname
            if hostname not in ("127.0.0.1", "localhost", None):
                external.append(hostname)
                route.abort()
            else:
                route.continue_()

        page.route("**/*", network_guard)
        page.goto(base_url, wait_until="networkidle")
        # The onboarding copy remains mounted beneath the cold-start splash.
        # Do not accept text that is present but completely covered as proof
        # that the first-use UI was actually visible to a user.
        expect(page.get_by_test_id("startup-splash")).to_be_hidden(timeout=25000)
        expect(page.get_by_text("从上次的事情继续", exact=True)).to_be_visible(timeout=25000)
        expect(page.get_by_text("Omni 会从资料中寻找依据并展示来源", exact=False)).to_be_visible()
        expect(page.get_by_text("相关资料片段会发送给该服务", exact=False)).to_be_visible()
        expect(page.get_by_text("屏幕与剪贴板捕获默认暂停", exact=False)).to_be_visible()
        page.screenshot(path=str(args.output_dir / "ui-first-use-wide.png"), full_page=True)
        results["startup_splash_hidden"] = True
        results["checks"].append("First-use UI is visible after the cold-start splash exits")

        layouts: list[dict[str, int]] = []
        for width, height, filename in (
            (390, 640, "ui-first-use-narrow.png"),
            (390, 480, "ui-first-use-short.png"),
        ):
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(100)
            overlay = page.locator("div.fixed.inset-0").first
            box = overlay.bounding_box()
            if not box or box["x"] < 0 or box["y"] < 0 or box["x"] + box["width"] > width + 1:
                raise AssertionError(f"Onboarding panel exceeds {width}x{height} viewport: {box}")
            overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
            if overflow:
                raise AssertionError(f"Document has horizontal overflow at {width}x{height}")
            page.screenshot(path=str(args.output_dir / filename), full_page=True)
            layouts.append({"width": width, "height": height, "panelWidth": round(box["width"]), "panelHeight": round(box["height"])})
        results["narrow_layouts"] = layouts
        results["external_requests_blocked"] = external
        results["checks"].append("Narrow and short viewport layout stays within the screen")
        context.close()
        browser.close()

    (args.output_dir / "ui-visual-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
