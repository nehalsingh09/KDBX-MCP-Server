# KDBX MCP Server

A lightweight MCP server for reading KeePass `*.kdbx` databases via the Model Context Protocol.

## Features

- Open a KDBX database with a password and optional key file
- List root groups and nested groups
- Search entries by title, username, URL, or notes
- Read entry details without exposing the database content beyond the requested fields

## Quick start

```bash
npm install
npm run build
node dist/index.js
```

The server uses stdio transport, so it can be launched by MCP hosts like Claude Desktop or other MCP clients.

## Tool summary

- `open_database`
  - `databasePath`: path to the `.kdbx` file
  - `password`: database password
  - `keyFilePath` (optional): path to a KeePass key file
- `list_groups`
  - `databasePath`: path to the opened database
  - `password`: password again for lazy re-open
- `search_entries`
  - `databasePath`: path to the database
  - `password`: password
  - `query`: text to match against title/username/url/notes

## Notes

This project is intentionally small and focused on safe read access. It does not implement database modification or export functionality.
