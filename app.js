const API_KEY_STORAGE = 'query_genie_openai_api_key';
const SCHEMA_STORAGE = 'query_genie_schema';
const MODEL = 'gpt-4o-mini';

const SQL_SYSTEM = "You are a SQL generator. Given a PostgreSQL schema and a user request, output only valid SQL without explanation. CRITICAL RULES - FOLLOW IN ORDER: STEP 1) TABLE NAME MAPPING (MANDATORY FIRST STEP): You MUST find the exact table name from 'AVAILABLE TABLE NAMES' that best matches the user's request. Examples: 'organizations' -> 'accounts', 'users' -> 'accounts', 'people' -> 'accounts'. If the user says 'organizations' but only 'accounts' exists, you MUST use 'accounts'. NEVER invent table names. STEP 2) Keep queries SIMPLE and MINIMAL. For 'get all X' or 'list X', use SELECT * FROM [exact_table_name]. STEP 3) Only use JOINs when explicitly needed. STEP 4) Only specify columns when specifically requested. STEP 5) You MUST ONLY use table/column names from the schema. STEP 6) If a table/column doesn't exist, state the limitation clearly.";

const RAILS_SYSTEM = "You are a Rails Active Record query generator. Given a PostgreSQL schema and a user request, output only valid Rails Active Record query code without explanation. Use Ruby syntax. CRITICAL RULES - FOLLOW IN ORDER: STEP 1) TABLE NAME MAPPING (MANDATORY FIRST STEP): You MUST find the exact table name from 'AVAILABLE TABLE NAMES' that best matches the user's request. Examples: 'organizations' -> 'accounts' table -> 'Account' model, 'users' -> 'accounts' table -> 'Account' model. Convert table name to Rails model: singular + capitalized (e.g., 'accounts' -> 'Account', 'users' -> 'User'). If the user says 'organizations' but only 'accounts' exists, you MUST use 'Account'. NEVER invent model names. STEP 2) Keep queries SIMPLE and MINIMAL. For 'get all X' or 'list X', use ModelName.all. STEP 3) Only use joins (.joins, .includes, .left_joins) when explicitly needed. STEP 4) Only use .select() when specifically requested. STEP 5) You MUST ONLY use table/column names from the schema. STEP 6) If a table/column doesn't exist, state the limitation clearly.";

function extractSchemaSummary(schemaText) {
  if (!schemaText || !schemaText.trim()) return { schemaSummary: 'No schema provided', tableNames: [] };
  const tables = {};
  const relationships = [];
  let currentTable = null;
  const skipKeywords = new Set(['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'KEY', 'UNIQUE', 'CHECK', 'INDEX', 'CREATE', 'ALTER', 'DROP']);
  const lines = schemaText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('/*')) continue;

    const createMatch = trimmed.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/i);
    if (createMatch) {
      currentTable = createMatch[1];
      tables[currentTable] = { columns: [], primaryKey: null };
      continue;
    }

    if (currentTable) {
      const colMatch = trimmed.match(/^\s*["']?(\w+)["']?\s+/);
      if (colMatch) {
        const col = colMatch[1];
        if (!skipKeywords.has(col.toUpperCase()) && !/^\s*(CONSTRAINT|PRIMARY|FOREIGN|KEY|UNIQUE|CHECK|INDEX)/i.test(trimmed)) {
          if (!tables[currentTable].columns.includes(col)) tables[currentTable].columns.push(col);
        }
      }
      const pkMatch = trimmed.match(/PRIMARY\s+KEY\s*\(["']?(\w+)["']?\)/i) || trimmed.match(/^\s*["']?(\w+)["']?\s+.*PRIMARY\s+KEY/i);
      if (pkMatch) tables[currentTable].primaryKey = pkMatch[1];
      const fkMatch = trimmed.match(/FOREIGN\s+KEY\s*\(["']?(\w+)["']?\)\s+REFERENCES\s+["']?(\w+)["']?\s*\(["']?(\w+)["']?\)/i) || trimmed.match(/^\s*["']?(\w+)["']?\s+.*REFERENCES\s+["']?(\w+)["']?\s*\(["']?(\w+)["']?\)/i);
      if (fkMatch) {
        relationships.push({
          fromTable: currentTable,
          fromColumn: fkMatch[1],
          toTable: fkMatch[2],
          toColumn: fkMatch[3] || 'id'
        });
      }
    }
  }

  const tableNames = Object.keys(tables).sort();
  let summary = `AVAILABLE TABLE NAMES (use ONLY these exact names): ${tableNames.join(', ')}\n\nAvailable Tables and Columns:\n`;
  if (tableNames.length === 0) {
    summary += 'No tables found in schema. Please ensure the schema contains CREATE TABLE statements.';
  } else {
    for (const [table, info] of Object.entries(tables)) {
      summary += `\nTable: ${table}\n`;
      if (info.primaryKey) summary += `  Primary Key: ${info.primaryKey}\n`;
      summary += `  Columns: ${info.columns.length ? info.columns.join(', ') : '(none found)'}\n`;
    }
  }
  if (relationships.length) {
    summary += '\n\nTable Relationships:\n';
    for (const r of relationships) {
      summary += `\n${r.fromTable}.${r.fromColumn} -> ${r.toTable}.${r.toColumn}\n  (Join: ${r.fromTable}.${r.fromColumn} = ${r.toTable}.${r.toColumn})\n`;
    }
  }
  return { schemaSummary: summary, tableNames };
}

function toModelName(table) {
  const singular = table.replace(/s$/, '');
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

function buildRailsModelNames(tableNames) {
  return tableNames.map(t => `${toModelName(t)} (from table: ${t})`).join(', ');
}

function cleanSql(text) {
  if (!text) return '';
  return text.replace(/^```sql\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').replace(/^`/, '').replace(/`$/, '').trim();
}

function cleanRails(text) {
  if (!text) return '';
  return text.replace(/^```ruby\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').replace(/^`/, '').replace(/`$/, '').trim();
}

async function chat(apiKey, messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, messages })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'OpenAI API error');
  return data.choices[0].message.content;
}

function getEl(id) { return document.getElementById(id); }

function showLoading(title) {
  getEl('resultSection').classList.remove('hidden');
  getEl('resultTitle').textContent = title;
  getEl('output').textContent = 'Generating query...';
  getEl('copyButton').classList.add('hidden');
}

function showResult(text) {
  getEl('output').textContent = text;
  getEl('copyButton').classList.remove('hidden');
}

function showError(msg) {
  getEl('output').textContent = msg;
  getEl('copyButton').classList.add('hidden');
}

async function generate(type) {
  const apiKey = localStorage.getItem(API_KEY_STORAGE)?.trim();
  if (!apiKey) {
    alert('Please enter and save your OpenAI API key.');
    return;
  }
  const schemaText = getEl('schemaText').value.trim();
  const prompt = getEl('prompt').value.trim();
  if (!prompt) {
    alert('Please enter a prompt.');
    return;
  }
  if (!schemaText) {
    alert('Please provide a schema.');
    return;
  }

  const { schemaSummary, tableNames } = extractSchemaSummary(schemaText);
  if (type === 'sql') {
    showLoading('3. Generated SQL');
    const userContent = `=== AVAILABLE TABLE NAMES (USE ONLY THESE EXACT NAMES) ===\n${tableNames.join(', ')}\n\n=== FULL SCHEMA DETAILS ===\n${schemaSummary}\n\n=== FULL SCHEMA DEFINITION ===\n${schemaText}\n\n=== USER REQUEST ===\n${prompt}\n\n=== REQUIRED PROCESS (FOLLOW IN ORDER) ===\n1. TABLE NAME IDENTIFICATION (REQUIRED FIRST): Look at 'AVAILABLE TABLE NAMES' above. Find the exact table name that matches the user's request. If user says 'organizations' but only 'accounts' exists, use 'accounts'. If user says 'users' but only 'accounts' exists, use 'accounts'. DO NOT use 'organizations' or 'users' if they are NOT in the list.\n2. SIMPLICITY: For 'get all X' requests, use SELECT * FROM [exact_table_name_from_step_1].\n3. JOINS: Only join if explicitly needed.\n4. COLUMNS: Only specify columns if explicitly requested.\n5. VALIDATION: Double-check every table/column name exists in the schema above.\n6. OUTPUT: Generate only the SQL query, nothing else.`;
    try {
      const content = await chat(apiKey, [{ role: 'system', content: SQL_SYSTEM }, { role: 'user', content: userContent }]);
      showResult(cleanSql(content));
    } catch (e) {
      showError(e.message || 'Failed to generate query');
    }
  } else {
    showLoading('3. Generated Rails Active Record Query');
    const modelNames = buildRailsModelNames(tableNames);
    const userContent = `=== AVAILABLE TABLE NAMES (USE ONLY THESE EXACT NAMES) ===\n${tableNames.join(', ')}\n\n=== RAILS MODEL NAMES (convert table names: singular + capitalized) ===\n${modelNames}\n\n=== FULL SCHEMA DETAILS ===\n${schemaSummary}\n\n=== FULL SCHEMA DEFINITION ===\n${schemaText}\n\n=== USER REQUEST ===\n${prompt}\n\n=== REQUIRED PROCESS (FOLLOW IN ORDER) ===\n1. TABLE NAME IDENTIFICATION (REQUIRED FIRST): Look at 'AVAILABLE TABLE NAMES' above. Find the exact table name that matches the user's request. If user says 'organizations' but only 'accounts' exists, use 'accounts'. If user says 'users' but only 'accounts' exists, use 'accounts'. DO NOT use 'organizations' or 'users' if they are NOT in the list.\n2. MODEL NAME CONVERSION: Convert the table name to Rails model: singular + capitalized. Example: 'accounts' -> 'Account', 'users' -> 'User'.\n3. SIMPLICITY: For 'get all X' requests, use ModelName.all (e.g., Account.all).\n4. JOINS: Only join if explicitly needed.\n5. SELECT: Only use .select() if specific columns are requested.\n6. VALIDATION: Double-check every table/column name exists in the schema above.\n7. OUTPUT: Generate only the Rails Active Record query, nothing else.`;
    try {
      const content = await chat(apiKey, [{ role: 'system', content: RAILS_SYSTEM }, { role: 'user', content: userContent }]);
      showResult(cleanRails(content));
    } catch (e) {
      showError(e.message || 'Failed to generate query');
    }
  }
}

function init() {
  const apiKeyInput = getEl('apiKeyInput');
  const schemaText = getEl('schemaText');
  const schemaFile = getEl('schemaFile');
  const clearSchema = getEl('clearSchema');
  const prompt = getEl('prompt');
  const generateSQL = getEl('generateSQL');
  const generateRails = getEl('generateRails');
  const copyButton = getEl('copyButton');

  const savedKey = localStorage.getItem(API_KEY_STORAGE);
  if (savedKey) apiKeyInput.value = savedKey;
  apiKeyInput.addEventListener('input', () => localStorage.setItem(API_KEY_STORAGE, apiKeyInput.value));
  apiKeyInput.addEventListener('blur', () => localStorage.setItem(API_KEY_STORAGE, apiKeyInput.value));

  const savedSchema = localStorage.getItem(SCHEMA_STORAGE);
  if (savedSchema) schemaText.value = savedSchema;
  schemaText.addEventListener('input', () => localStorage.setItem(SCHEMA_STORAGE, schemaText.value));

  schemaFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        schemaText.value = ev.target.result;
        localStorage.setItem(SCHEMA_STORAGE, schemaText.value);
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  });

  clearSchema.addEventListener('click', () => {
    schemaText.value = '';
    localStorage.removeItem(SCHEMA_STORAGE);
  });

  generateSQL.addEventListener('click', () => generate('sql'));
  generateRails.addEventListener('click', () => generate('rails'));

  copyButton.addEventListener('click', () => {
    const text = getEl('output').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const orig = copyButton.textContent;
      copyButton.textContent = 'Copied!';
      setTimeout(() => { copyButton.textContent = orig; }, 2000);
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
