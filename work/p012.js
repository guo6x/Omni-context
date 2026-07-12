const fs = require('fs');
const path = require('path');
const base = process.cwd();

// P0-12: AgentLoop concurrency lock
let p = path.join(base, 'brain-server/src/agent/agent-loop.ts');
let c = fs.readFileSync(p, 'utf8');
c = c.replace('private cycleCount = 0;', 'private cycleCount = 0;\n  private isCycleRunning = false;\n  private skippedCycleCount = 0;\n  private cycleTimeoutMs = 4 * 60 * 1000;');
c = c.replace('setInterval(() => this.runCycle()', 'setInterval(() => {\n      if (this.isCycleRunning) {\n        this.skippedCycleCount++;\n        return;\n      }\n      this.runCycle()\n    }');
c = c.replace("console.log('[AgentLoop]", 'if (this.isCycleRunning) {\n      this.skippedCycleCount++;\n      return;\n    }\n    this.isCycleRunning = true;\n    const cycleTimeout = setTimeout(() => {\n      if (this.isCycleRunning) {\n        console.warn("[AgentLoop] Cycle timeout - forcing completion");\n        this.isCycleRunning = false;\n      }\n    }, this.cycleTimeoutMs);\n\n    console.log(\x27[AgentLoop]');
c = c.replace('getCycleCount(): number { return this.cycleCount; }', 'getCycleCount(): number { return this.cycleCount; }\n\n  getSkippedCount(): number { return this.skippedCycleCount; }\n\n  isRunning(): boolean { return this.isCycleRunning; }');
fs.writeFileSync(p, c, 'utf8');
console.log('P0-12 done');
