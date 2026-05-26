export interface McpClientMeta {
  id: string;
  name: string;
  logo: string;
  supports: 'auto' | 'manual';
  config_path_template: string;
  json_field: string;
  reload_hint: string;
  steps: string[];
}

export const MCP_CLIENTS: McpClientMeta[] = [
  {
    id: 'claude',
    name: 'Claude Desktop',
    logo: 'claude',
    supports: 'auto',
    config_path_template: 'Windows: %APPDATA%\\Claude\\claude_desktop_config.json\nmacOS: ~/Library/Application Support/Claude/claude_desktop_config.json',
    json_field: 'mcpServers.omni-context',
    reload_hint: 'mcp.claude_reload_hint',
    steps: [
      'mcp.claude_step_0',
      'mcp.claude_step_1',
      'mcp.claude_step_2',
    ]
  },
  {
    id: 'cursor',
    name: 'Cursor',
    logo: 'cursor',
    supports: 'auto',
    config_path_template: 'mcp.cursor_config_path',
    json_field: 'mcpServers.omni-context',
    reload_hint: 'mcp.cursor_reload_hint',
    steps: [
      'mcp.cursor_step_0',
      'mcp.cursor_step_1',
      'mcp.cursor_step_2',
    ]
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    logo: 'windsurf',
    supports: 'auto',
    config_path_template: 'Windows: %USERPROFILE%\\.codeium\\windsurf\\mcp_config.json\nmacOS/Linux: ~/.codeium/windsurf/mcp_config.json',
    json_field: 'mcpServers.omni-context',
    reload_hint: 'mcp.windsurf_reload_hint',
    steps: [
      'mcp.windsurf_step_0',
      'mcp.windsurf_step_1',
    ]
  },
  {
    id: 'trae',
    name: 'Trae',
    logo: 'trae',
    supports: 'auto',
    config_path_template: 'mcp.trae_config_path',
    json_field: 'mcpServers.omni-context',
    reload_hint: 'mcp.trae_reload_hint',
    steps: [
      'mcp.trae_step_0',
      'mcp.trae_step_1',
    ]
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    logo: 'lmstudio',
    supports: 'auto',
    config_path_template: 'Windows: %USERPROFILE%\\.lmstudio\\mcp.json\nmacOS/Linux: ~/.lmstudio/mcp.json',
    json_field: 'mcpServers.omni-context',
    reload_hint: 'mcp.lmstudio_reload_hint',
    steps: [
      'mcp.lmstudio_step_0',
      'mcp.lmstudio_step_1',
    ]
  },
  {
    id: 'cline',
    name: 'Cline (VS Code)',
    logo: 'cline',
    supports: 'auto',
    config_path_template: 'Windows: %APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json\nmacOS: ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    json_field: 'mcpServers.omni-context',
    reload_hint: 'mcp.cline_reload_hint',
    steps: [
      'mcp.cline_step_0',
      'mcp.cline_step_1',
      'mcp.cline_step_2',
    ]
  },
  {
    id: 'roo',
    name: 'Roo Code (VS Code)',
    logo: 'roo',
    supports: 'auto',
    config_path_template: 'Windows: %APPDATA%\\Code\\User\\globalStorage\\rooveterinaryinc.roo-cline\\settings\\cline_mcp_settings.json\nmacOS: ~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json',
    json_field: 'mcpServers.omni-context',
    reload_hint: 'mcp.roo_reload_hint',
    steps: [
      'mcp.roo_step_0',
      'mcp.roo_step_1',
    ]
  },
  {
    id: 'continue',
    name: 'Continue.dev',
    logo: 'continue',
    supports: 'auto',
    config_path_template: 'Windows: %USERPROFILE%\\.continue\\config.json\nmacOS/Linux: ~/.continue/config.json',
    json_field: 'experimental.modelContextProtocolServers.omni-context',
    reload_hint: 'mcp.continue_reload_hint',
    steps: [
      'mcp.continue_step_0',
      'mcp.continue_step_1',
    ]
  },
  {
    id: 'zed',
    name: 'Zed Editor',
    logo: 'zed',
    supports: 'manual',
    config_path_template: '~/.config/zed/settings.json',
    json_field: 'context_servers.omni-context',
    reload_hint: 'mcp.zed_reload_hint',
    steps: [
      'mcp.zed_step_0',
      'mcp.zed_step_1',
      'mcp.zed_step_2',
    ]
  },
  {
    id: 'goose',
    name: 'Goose CLI',
    logo: 'goose',
    supports: 'manual',
    config_path_template: '~/.config/goose/config.yaml',
    json_field: 'mcp.goose_json_field',
    reload_hint: 'mcp.goose_reload_hint',
    steps: [
      'mcp.goose_step_0',
      'mcp.goose_step_1',
      'mcp.goose_step_2',
    ]
  },
  {
    id: 'cherrystudio',
    name: 'Cherry Studio',
    logo: 'cherrystudio',
    supports: 'manual',
    config_path_template: 'mcp.cherrystudio_config_path',
    json_field: 'mcp.cherrystudio_json_field',
    reload_hint: 'mcp.cherrystudio_reload_hint',
    steps: [
      'mcp.cherrystudio_step_0',
      'mcp.cherrystudio_step_1',
      'mcp.cherrystudio_step_2',
      'mcp.cherrystudio_step_3',
    ]
  },
  {
    id: 'chatbox',
    name: 'ChatBox',
    logo: 'chatbox',
    supports: 'manual',
    config_path_template: 'mcp.chatbox_config_path',
    json_field: 'mcp.chatbox_json_field',
    reload_hint: 'mcp.chatbox_reload_hint',
    steps: [
      'mcp.chatbox_step_0',
      'mcp.chatbox_step_1',
      'mcp.chatbox_step_2',
    ]
  }
];
