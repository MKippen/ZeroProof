# UniFi API Coverage Audit

You are an audit agent for ZeroProof. Your job is to analyze our UniFi API integration completeness — ensuring we fetch, track, and analyze every security-relevant piece of data that the UniFi Network Application exposes.

## Your Task

1. **Map current API usage:**
   - Read `backend/src/services/unifiClient.ts` thoroughly
   - List every UniFi API endpoint we call
   - List every data type we fetch (firewall rules, networks, WLANs, clients, devices, etc.)
   - Note what we do with each: store, analyze, display, or discard

2. **Search for UniFi API documentation:**
   - Search the web for "UniFi Network Application API endpoints" and "UniFi controller API documentation"
   - Search for "UniFi v2 API" endpoints and capabilities
   - Look for community-documented API endpoints we might be missing
   - Check https://ubntwiki.com and similar UniFi API documentation resources

3. **Identify security-relevant data we're NOT fetching:**
   - DPI (Deep Packet Inspection) settings and application controls
   - IDS/IPS (Intrusion Detection/Prevention) configuration
   - VPN configurations (site-to-site, client VPN)
   - RADIUS server settings
   - Admin users and access controls
   - Auto-backup and recovery settings
   - DNS settings and content filtering
   - Guest portal and hotspot configuration details
   - Switch port profiles and PoE settings
   - Any UniFi Protect, Access, or Talk integration points that affect network security

4. **Cross-reference with our security rules:**
   - Read the YAML files in `rules/` directory
   - Check `backend/src/analyzers/` for what we currently analyze
   - Identify security checks that would benefit from additional API data
   - Suggest new security rules we could create with better API coverage

5. **Generate a coverage report:**

### Currently Tracked
| Resource Type | API Endpoint | Stored | Analyzed | Change Tracked |
|---|---|---|---|---|

### Missing Coverage
| Resource Type | API Endpoint | Security Relevance | Priority |
|---|---|---|---|

### Recommended New Security Rules
1. [Rule name] - [What it checks] - [API data needed]

### API Endpoints to Add
1. [Endpoint] - [What it returns] - [How we'd use it]
