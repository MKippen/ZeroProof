module.exports = {
  extends: ['@commitlint/config-conventional'],
  // Dependabot includes long release URLs and dependency metadata in the body.
  // Keep conventional subject validation while allowing those generated lines.
  rules: { 'body-max-line-length': [0] },
};
