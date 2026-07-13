(function initializePrivacyPolicy(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OmniPrivacy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPrivacyPolicy() {
  const DEFAULT_SETTINGS = Object.freeze({
    language: 'en',
    autoCapture: false,
    syncEnabled: true,
    capturePaused: false,
    previewBeforeCapture: true,
    redactSensitiveFields: true,
    allowedDomains: [],
    blockedDomains: [],
    privacyConsentVersion: 1,
  });

  const AUTOMATIC_CAPTURE_DOMAINS = Object.freeze([
    'chatgpt.com',
    'chat.openai.com',
    'claude.ai',
    'gemini.google.com',
  ]);
  const CAPTURE_CHUNK_CHARACTERS = 12000;

  const SENSITIVE_DOMAIN_PATTERNS = Object.freeze([
    /(^|\.)accounts\./i,
    /(^|\.)login\./i,
    /(^|\.)mail\.google\.com$/i,
    /(^|\.)outlook\.(?:live|office)\.com$/i,
    /(^|\.)paypal\.com$/i,
    /(^|\.)stripe\.com$/i,
    /(^|\.)(?:bank|banking|health|medical|patient|insurance)[.-]/i,
    /(^|\.)(?:1password|bitwarden|lastpass)\.com$/i,
  ]);

  const REDACTION_RULES = Object.freeze([
    { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi },
    { id: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}={0,2}\b/gi },
    { id: 'api-key', pattern: /\b(?:sk-(?:proj-|ant-)?|gh[pousr]_)[A-Za-z0-9_-]{16,}\b/g },
    { id: 'password-field', pattern: /\b(password|passwd|pwd|secret|api[_-]?key)\b\s*[:=]\s*([^\s,;]{4,})/gi, preserveLabel: true },
    { id: 'credit-card', pattern: /\b(?:\d[ -]*?){13,19}\b/g },
  ]);

  function uniqueDomains(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(normalizeDomain).filter(Boolean))];
  }

  function mergeSettings(value) {
    const input = value && typeof value === 'object' ? value : {};
    return {
      ...DEFAULT_SETTINGS,
      ...input,
      autoCapture: input.autoCapture === true,
      capturePaused: input.capturePaused === true,
      previewBeforeCapture: input.previewBeforeCapture !== false,
      redactSensitiveFields: input.redactSensitiveFields !== false,
      allowedDomains: uniqueDomains(input.allowedDomains),
      blockedDomains: uniqueDomains(input.blockedDomains),
    };
  }

  function migrateSettings(value) {
    const settings = mergeSettings(value);
    if (!value || value.privacyConsentVersion !== 1) {
      settings.autoCapture = false;
      settings.allowedDomains = [];
      settings.privacyConsentVersion = 1;
    }
    return settings;
  }

  function normalizeDomain(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const hostname = value.includes('://') ? new URL(value).hostname : value;
      return hostname.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    } catch {
      return '';
    }
  }

  function domainMatches(domain, configuredDomain) {
    return domain === configuredDomain || domain.endsWith(`.${configuredDomain}`);
  }

  function listContainsDomain(list, domain) {
    return list.some((entry) => domainMatches(domain, entry));
  }

  function isSensitiveDomain(domain) {
    return SENSITIVE_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain));
  }

  function evaluateCapturePolicy(rawSettings, url, options) {
    const settings = mergeSettings(rawSettings);
    const domain = normalizeDomain(url);
    const automatic = options && options.automatic === true;
    if (!domain) return { allowed: false, reason: 'invalid-url', domain };
    if (settings.capturePaused) return { allowed: false, reason: 'paused', domain };
    if (listContainsDomain(settings.blockedDomains, domain)) {
      return { allowed: false, reason: 'blocked-domain', domain };
    }

    const explicitlyAllowed = listContainsDomain(settings.allowedDomains, domain);
    if (isSensitiveDomain(domain) && !explicitlyAllowed) {
      return { allowed: false, reason: 'sensitive-domain', domain };
    }

    if (automatic) {
      if (!settings.autoCapture) return { allowed: false, reason: 'auto-disabled', domain };
      if (!AUTOMATIC_CAPTURE_DOMAINS.some((entry) => domainMatches(domain, entry))) {
        return { allowed: false, reason: 'unsupported-auto-domain', domain };
      }
      if (!explicitlyAllowed) return { allowed: false, reason: 'domain-not-enabled', domain };
    }
    return { allowed: true, reason: 'allowed', domain };
  }

  function redactSensitiveText(value) {
    let text = typeof value === 'string' ? value : '';
    const counts = {};
    for (const rule of REDACTION_RULES) {
      let count = 0;
      text = text.replace(rule.pattern, (...args) => {
        count += 1;
        return rule.preserveLabel ? `${args[1]}=[REDACTED:${rule.id}]` : `[REDACTED:${rule.id}]`;
      });
      if (count > 0) counts[rule.id] = count;
    }
    return {
      text,
      redactedCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
      counts,
    };
  }

  function captureStats(text, redactedCount) {
    return {
      sentCharacters: typeof text === 'string' ? text.length : 0,
      payloadChunks: text ? Math.ceil(text.length / CAPTURE_CHUNK_CHARACTERS) : 0,
      redactedCount: Number(redactedCount) || 0,
    };
  }

  return {
    AUTOMATIC_CAPTURE_DOMAINS,
    CAPTURE_CHUNK_CHARACTERS,
    DEFAULT_SETTINGS,
    captureStats,
    evaluateCapturePolicy,
    isSensitiveDomain,
    mergeSettings,
    migrateSettings,
    normalizeDomain,
    redactSensitiveText,
  };
});
