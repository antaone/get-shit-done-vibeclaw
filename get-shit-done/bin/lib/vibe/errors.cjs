'use strict';

class VibeError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'VibeError';
    this.code = code;
    this.details = details;
  }
}

function invariant(condition, code, message, details = null) {
  if (!condition) throw new VibeError(code, message, details);
}

module.exports = { VibeError, invariant };

