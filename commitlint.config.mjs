export default {
  extends: ['@commitlint/config-conventional'],
  // Dependabot's generated dependency tables cannot be reliably word-wrapped.
  // Keep every other rule, and keep the default body limit for human PRs.
  rules:
    process.env.COMMITLINT_DEPENDABOT_PR === 'true'
      ? { 'body-max-line-length': [0] }
      : {},
};
