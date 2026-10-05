# Skills Collection

A collection of agent skills for development and documentation.

## Plugins

| Plugin | Description | Skills |
|---|---|---|
| [development](./plugins/development) | Assertion-driven design and boundary-based error handling for fail-fast code | negative-space-programming |
| [documents](./plugins/documents) | Standards-based changelog and documentation maintenance | managing-changelog, managing-documentation |

## Installation

Add this repository as a marketplace, then install the plugins you need:

```
/plugin marketplace add thoeltig/skills-collection
/plugin install development@skills-collection
/plugin install documents@skills-collection
```

## Structure

Each plugin lives under `plugins/<name>/` with its own `plugin.json` manifest and a `skills/` folder containing one or more skills. See each plugin's README for details.

## License

See root [LICENSE](./LICENSE) for details.

## Author

[Thore Höltig](https://github.com/thoeltig)
