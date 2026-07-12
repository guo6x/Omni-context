function assertPackagingSucceeded(failures) {
  if (failures.length > 0) {
    throw new Error(`Packaging failed for required components: ${failures.join(', ')}`);
  }
}

module.exports = { assertPackagingSucceeded };
