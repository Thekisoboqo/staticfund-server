import './style.css';
import * as monaco from 'monaco-editor';

/**
 * EA CONVERTER PRO - Core Logic
 * Handles conversion between Pine Script and MQL5
 */

// Basic Translation Mappings (Pine v5 -> MQL5)
const PINE_TO_MQL5 = {
  // Metadata & Setup
  'indicator\\("([^"]+)"': (match, name) => `// MQL5 Generated for: ${name}\n#property copyright "EA Converter Pro"\n#property version "1.00"\n#property indicator_separate_window`,
  
  // Indicators
  'ta.rsi\\(([^,]+), ([^\\)]+)\\)': (match, source, length) => `iRSI(_Symbol, _Period, ${length})`,
  'ta.sma\\(([^,]+), ([^\\)]+)\\)': (match, source, length) => `iMA(_Symbol, _Period, ${length}, 0, MODE_SMA, PRICE_CLOSE)`,
  'ta.ema\\(([^,]+), ([^\\)]+)\\)': (match, source, length) => `iMA(_Symbol, _Period, ${length}, 0, MODE_EMA, PRICE_CLOSE)`,

  // Core Variables
  'close': 'iClose(_Symbol, _Period, 0)',
  'open': 'iOpen(_Symbol, _Period, 0)',
  'high': 'iHigh(_Symbol, _Period, 0)',
  'low': 'iLow(_Symbol, _Period, 0)',
  
  // Math & Logic
  'math.abs': 'MathAbs',
  'math.max': 'MathMax',
  'math.min': 'MathMin',
  'if \\((.+)\\)': (match, cond) => `if(${cond})`,
  
  // Output
  'plot\\(([^,]+)(, [^\\)]+)?\\)': (match, val) => `// Plot logic for ${val} needs custom buffer assignment`,
};

class ConverterApp {
  constructor() {
    this.convertBtn = document.getElementById('convert-btn');
    this.clearBtn = document.getElementById('clear-btn');
    this.copyBtn = document.getElementById('copy-btn');
    this.logs = document.getElementById('logs');
    this.pipelinePulse = document.querySelector('.pipeline-pulse');

    this.initMonaco();
    this.initEvents();
  }

  initMonaco() {
    // Monaco respects the container dims, but we set explicit theme configuration
    monaco.editor.defineTheme('midnight-terminal', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { background: '0a0a0c' }
      ],
      colors: {
        'editor.background': '#0a0a0c00', // Transparent, let css handle
        'editor.lineHighlightBackground': '#ffffff0a'
      }
    });

    this.sourceEditor = monaco.editor.create(document.getElementById('source-editor'), {
      value: '// Paste your Pine Script here...\n//@version=5\nindicator("Premium Strategy", overlay=true)\nrsi = ta.rsi(close, 14)\nplot(rsi)',
      language: 'javascript', // Closest to Pine
      theme: 'midnight-terminal',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      fontFamily: 'Roboto Mono',
      scrollBeyondLastLine: false,
    });

    this.targetEditor = monaco.editor.create(document.getElementById('target-editor'), {
      value: '// Your MQL5 code will appear here...',
      language: 'cpp', // Closest to MQL5
      theme: 'midnight-terminal',
      automaticLayout: true,
      readOnly: true,
      minimap: { enabled: false },
      fontSize: 14,
      fontFamily: 'Roboto Mono',
      scrollBeyondLastLine: false,
    });
  }

  initEvents() {
    this.convertBtn.addEventListener('click', () => this.handleConvert());
    this.clearBtn.addEventListener('click', () => this.handleClear());
    this.copyBtn.addEventListener('click', () => this.handleCopy());
    
    // Add some interactivity to presets
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        this.addLog(`Loaded ${e.target.innerText} preset context.`, 'system');
      });
    });
  }

  addLog(msg, type = 'system') {
    const entry = document.createElement('span');
    entry.className = `log-entry ${type}`;
    const timestamp = new Date().toLocaleTimeString([], { hour12: false });
    entry.innerText = `[${timestamp}] ${msg}`;
    this.logs.appendChild(entry);
    this.logs.scrollTop = this.logs.scrollHeight;
  }

  handleClear() {
    this.sourceEditor.setValue('');
    this.targetEditor.setValue('');
    this.addLog('Workspace cleared.', 'system');
  }

  handleCopy() {
    const code = this.targetEditor.getValue();
    if (!code || code === '// Your MQL5 code will appear here...') return;
    
    navigator.clipboard.writeText(code);
    this.addLog('Code copied to clipboard!', 'success');
    
    const oldText = this.copyBtn.innerText;
    this.copyBtn.innerText = 'COPIED!';
    setTimeout(() => this.copyBtn.innerText = oldText, 2000);
  }

  handleConvert() {
    const input = this.sourceEditor.getValue().trim();
    if (!input || input === '// Paste your Pine Script here...') {
      this.addLog('Error: Source code is empty.', 'error');
      return;
    }

    this.addLog('Starting conversion process...', 'system');
    this.convertBtn.disabled = true;
    this.convertBtn.innerText = 'CONVERTING...';
    
    // Trigger visual pulse
    this.pipelinePulse.classList.add('active');

    // Simulate analysis delay
    setTimeout(() => {
      let output = input;

      // Apply regex mappings
      let matchedCount = 0;
      for (const [pattern, replacement] of Object.entries(PINE_TO_MQL5)) {
        const regex = new RegExp(pattern, 'g');
        const count = (output.match(regex) || []).length;
        matchedCount += count;
        
        if (typeof replacement === 'function') {
          output = output.replace(regex, replacement);
        } else {
          output = output.replace(regex, replacement);
        }
      }

      // Add MQL5 Boilerplate if not present
      if (!output.includes('OnInit')) {
        output = `//--- EA Converter Pro Output\n\nint OnInit() {\n   return(INIT_SUCCEEDED);\n}\n\nvoid OnDeinit(const int reason) {\n}\n\nvoid OnTick() {\n\n${output}\n\n}\n`;
      }

      this.targetEditor.setValue(output);
      this.addLog(`Conversion successful! Patterns optimized: ${matchedCount}`, 'success');
      
      // Reset UI state
      this.convertBtn.disabled = false;
      this.convertBtn.innerText = 'CONVERT TO MQL5';
      setTimeout(() => this.pipelinePulse.classList.remove('active'), 1000);
    }, 1200);
  }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  new ConverterApp();
});
