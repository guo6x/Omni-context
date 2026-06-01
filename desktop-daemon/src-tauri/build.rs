fn main() {
  // 重新嵌入窗口/exe 图标（icon.ico 更新后强制 build script 重跑）
  println!("cargo:rerun-if-changed=icons/icon.ico");
  tauri_build::build()
}
