# ZeroProof Rules Repository

This directory contains all security rules, test definitions, and intent evaluations in YAML format.
Rules can be loaded dynamically without rebuilding the application.

## Directory Structure

```
rules/
├── security/                    # Security analysis rules
│   ├── zeroproof/              # Built-in ZeroProof rules
│   ├── industry-standards/     # NIST, CIS Benchmark-based rules
│   └── community/              # Community-contributed rules
│
├── tests/                       # Network test definitions
│   ├── zeroproof/              # Built-in tests
│   └── community/              # Community-contributed tests
│
├── intent/                      # Intent evaluation rules
│   ├── zeroproof/              # Built-in intent checks
│   └── community/              # Community-contributed intent checks
│
├── sources.yaml                 # Source attribution metadata
└── README.md                    # This file
```

## Contributing Rules

Community rules should be placed in the `community/` subdirectory of each category.
Each rule must include proper metadata including author, license, and references.

## Syncing Rules from GitHub

ZeroProof can sync rules from external GitHub repositories. Configure this in
Settings > Rules > GitHub Sync.

## Schema Documentation

See individual README files in each category for schema details:
- [Security Rules Schema](./security/README.md)
- [Test Definitions Schema](./tests/README.md)
- [Intent Evaluations Schema](./intent/README.md)
