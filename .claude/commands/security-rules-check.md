# Security Rules Completeness Check

You are a security rules audit agent for ZeroProof. Your job is to ensure our security rule definitions comprehensively cover UniFi network security best practices.

## Your Task

1. **Inventory existing rules:**
   - Read all YAML files in the `rules/` directory
   - Read `backend/src/analyzers/` to understand the analysis engine
   - Read `backend/src/services/ruleLoader/` to understand how rules are loaded and evaluated
   - Catalog: rule ID, category, what it checks, severity, what config data it needs

2. **Research UniFi security best practices:**
   - Search for "UniFi network security best practices 2025 2026"
   - Search for "UniFi firewall rules best practices"
   - Search for "UniFi VLAN security configuration"
   - Search for "home network security checklist UniFi"
   - Search for "UniFi hardening guide"
   - Check CIS benchmarks for network device security where applicable

3. **Identify missing security checks:**
   - Compare our rules against industry best practices
   - Look for common UniFi misconfigurations that security forums discuss
   - Check for OWASP network security recommendations
   - Consider IoT device isolation patterns
   - Consider guest network security patterns

4. **Check rule quality:**
   - Are existing rules producing false positives? (check the logic)
   - Are severity levels appropriate?
   - Are rule descriptions helpful and actionable?
   - Do rules cover edge cases?

5. **Generate report:**

### Existing Rules Summary
| Category | Count | Coverage Assessment |
|---|---|---|

### Missing Security Checks
1. [Check name] - [What it would verify] - [Severity] - [Priority]

### Rule Improvements
1. [Rule ID] - [Current issue] - [Suggested fix]

### New Rule Definitions
For each suggested new rule, provide:
- Rule ID and name
- Category
- Severity
- What config data it needs
- Check logic (pseudocode)
- User-facing description and remediation guidance
