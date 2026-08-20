'use strict';

const { VibeError } = require('./errors.cjs');

function stripComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if ((char === '"' || char === "'") && (i === 0 || value[i - 1] !== '\\')) {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
    }
    if (char === '#' && !quote && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value;
}

function parseScalar(raw) {
  const value = stripComment(raw).trim();
  if (value === '') return '';
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === '{}') return {};
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch (error) {
      throw new VibeError('CONFIG_PARSE_ERROR', `Invalid quoted YAML scalar: ${value}`, { cause: error.message });
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => parseScalar(part));
  }
  return value;
}

function splitKeyValue(text, lineNumber) {
  const match = text.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
  if (!match) {
    throw new VibeError('CONFIG_PARSE_ERROR', `Unsupported YAML syntax at line ${lineNumber}: ${text}`);
  }
  return { key: match[1], value: match[2] ?? '' };
}

function parseYaml(source, sourceName = 'YAML') {
  const records = [];
  const lines = String(source).replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (/\t/.test(raw.slice(0, raw.search(/\S|$/)))) {
      throw new VibeError('CONFIG_PARSE_ERROR', `${sourceName}:${index + 1} uses tabs for indentation`);
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    records.push({ indent, text: raw.trimStart(), line: index + 1 });
  }
  if (records.length === 0) return {};

  function parseBlock(start, indent) {
    const arrayMode = records[start].text === '-' || records[start].text.startsWith('- ');
    const result = arrayMode ? [] : {};
    let cursor = start;

    while (cursor < records.length) {
      const record = records[cursor];
      if (record.indent < indent) break;
      if (record.indent > indent) {
        throw new VibeError('CONFIG_PARSE_ERROR', `${sourceName}:${record.line} has unexpected indentation`);
      }

      if (arrayMode) {
        if (!(record.text === '-' || record.text.startsWith('- '))) {
          throw new VibeError('CONFIG_PARSE_ERROR', `${sourceName}:${record.line} mixes arrays and mappings`);
        }
        const itemText = record.text.slice(1).trim();
        if (!itemText) {
          const next = records[cursor + 1];
          if (!next || next.indent <= indent) result.push(null);
          else {
            const nested = parseBlock(cursor + 1, next.indent);
            result.push(nested.value);
            cursor = nested.cursor - 1;
          }
        } else if (/^[A-Za-z0-9_.-]+:/.test(itemText)) {
          const pair = splitKeyValue(itemText, record.line);
          const item = {};
          item[pair.key] = pair.value === '' ? {} : parseScalar(pair.value);
          result.push(item);
        } else {
          result.push(parseScalar(itemText));
        }
      } else {
        if (record.text === '-' || record.text.startsWith('- ')) {
          throw new VibeError('CONFIG_PARSE_ERROR', `${sourceName}:${record.line} mixes mappings and arrays`);
        }
        const pair = splitKeyValue(record.text, record.line);
        if (Object.prototype.hasOwnProperty.call(result, pair.key)) {
          throw new VibeError('CONFIG_PARSE_ERROR', `${sourceName}:${record.line} duplicates key '${pair.key}'`);
        }
        if (pair.value !== '') {
          result[pair.key] = parseScalar(pair.value);
        } else {
          const next = records[cursor + 1];
          if (!next || next.indent <= indent) {
            result[pair.key] = {};
          } else {
            const nested = parseBlock(cursor + 1, next.indent);
            result[pair.key] = nested.value;
            cursor = nested.cursor - 1;
          }
        }
      }
      cursor += 1;
    }
    return { value: result, cursor };
  }

  return parseBlock(0, records[0].indent).value;
}

function quoteString(value) {
  if (value === '' || /^(?:null|true|false|~|-?(?:0|[1-9]\d*)(?:\.\d+)?)$/.test(value)) {
    return JSON.stringify(value);
  }
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value) && !value.includes('#')) return value;
  return JSON.stringify(value);
}

function scalarToYaml(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return quoteString(String(value));
}

function stringifyYaml(value) {
  const lines = [];
  function emit(node, indent) {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === 'object') {
          lines.push(`${' '.repeat(indent)}-`);
          emit(item, indent + 2);
        } else {
          lines.push(`${' '.repeat(indent)}- ${scalarToYaml(item)}`);
        }
      }
      return;
    }
    for (const [key, item] of Object.entries(node || {})) {
      if (item && typeof item === 'object') {
        if (Array.isArray(item) && item.length === 0) {
          lines.push(`${' '.repeat(indent)}${key}: []`);
        } else if (!Array.isArray(item) && Object.keys(item).length === 0) {
          lines.push(`${' '.repeat(indent)}${key}: {}`);
        } else {
          lines.push(`${' '.repeat(indent)}${key}:`);
          emit(item, indent + 2);
        }
      } else {
        lines.push(`${' '.repeat(indent)}${key}: ${scalarToYaml(item)}`);
      }
    }
  }
  emit(value, 0);
  return `${lines.join('\n')}\n`;
}

module.exports = { parseYaml, stringifyYaml };
