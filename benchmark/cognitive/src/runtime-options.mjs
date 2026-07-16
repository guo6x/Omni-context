import path from 'node:path';

const EXACT_COMMIT_RE = /^[a-f0-9]{40}$/;

export function resolveFullOmniRuntimeOptions({
  brainServerRoot,
  expectedProductCommit,
  expectedSelectorVersion = 'evidence-selector-v1',
}) {
  if (!brainServerRoot) {
    throw new Error('full_omni requires --brain-server-root (or OMNI_BRAIN_SERVER_ROOT)');
  }
  if (!expectedProductCommit) {
    throw new Error('full_omni requires --expected-product-commit (or OMNI_EXPECTED_PRODUCT_COMMIT)');
  }
  if (!EXACT_COMMIT_RE.test(expectedProductCommit)) {
    throw new Error('--expected-product-commit must be an exact 40-character Git SHA');
  }
  if (!expectedSelectorVersion) {
    throw new Error('--expected-selector-version must not be empty');
  }
  return {
    brainServerRoot: path.resolve(brainServerRoot),
    expectedProductCommit,
    expectedSelectorVersion,
  };
}
