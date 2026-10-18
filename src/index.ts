import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import kdbxweb from 'kdbxweb';
import fs from 'node:fs/promises';
import path from 'node:path';

const server = new Server(
  {
    name: 'kdbx-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

const dbCache = new Map<string, { db: any; lastLoaded: number }>();
const TOOL_TIMEOUT_MS = 60_000;

function sanitizeEntry(entry: any) {
  return {
    uuid: entry.uuid ? entry.uuid.toString() : undefined,
    title: entry.fields.Title ?? '',
    username: entry.fields.UserName ?? '',
    url: entry.fields.URL ?? '',
    notes: entry.fields.Notes ?? '',
    group: entry.parentGroup?.name ?? '',
    icon: entry.icon ?? 0,
  };
}

function sanitizeGroup(group: any, depth = 0) {
  return {
    id: group.uuid ? group.uuid.toString() : `${depth}-${group.name ?? 'group'}`,
    name: group.name ?? 'Untitled group',
    path: group.path ?? group.name ?? 'Untitled group',
    entries: (group.entries ?? []).map(sanitizeEntry),
    groups: (group.groups ?? []).map((child: any) => sanitizeGroup(child, depth + 1)),
  };
}

function findEntryMatches(entry: any, query: string) {
  const haystack = [
    entry.fields.Title ?? '',
    entry.fields.UserName ?? '',
    entry.fields.URL ?? '',
    entry.fields.Notes ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

async function loadDatabase(databasePath: string, password: string, keyFilePath?: string) {
  const normalized = path.resolve(databasePath);

  const existing = dbCache.get(normalized);
  if (existing) {
    return existing.db;
  }

  const fileBytes = await fs.readFile(normalized);
  const keyFileBytes = keyFilePath ? await fs.readFile(path.resolve(keyFilePath)) : undefined;

  const credentials = new kdbxweb.Credentials(
    kdbxweb.ProtectedValue.fromString(password),
    keyFileBytes ? keyFileBytes : undefined,
  );

  const db = await kdbxweb.Kdbx.load(toArrayBuffer(fileBytes), credentials);
  dbCache.set(normalized, { db, lastLoaded: Date.now() });
  return db;
}

const tools: Tool[] = [
  {
    name: 'open_database',
    description: 'Open a KeePass .kdbx database using a password and optional key file.',
    inputSchema: {
      type: 'object',
      properties: {
        databasePath: { type: 'string', description: 'Absolute or relative path to the .kdbx database file.' },
        password: { type: 'string', description: 'Database password.' },
        keyFilePath: {
          type: 'string',
          description: 'Optional path to a KeePass key file.',
        },
      },
      required: ['databasePath', 'password'],
    },
  },
  {
    name: 'list_groups',
    description: 'List the root group and nested groups in a loaded KDBX database.',
    inputSchema: {
      type: 'object',
      properties: {
        databasePath: { type: 'string', description: 'Path to the .kdbx database file.' },
        password: { type: 'string', description: 'Password used to unlock the database.' },
        keyFilePath: { type: 'string', description: 'Optional key file path.' },
      },
      required: ['databasePath', 'password'],
    },
  },
  {
    name: 'search_entries',
    description: 'Search entries by title, username, URL, or notes across all groups in a database.',
    inputSchema: {
      type: 'object',
      properties: {
        databasePath: { type: 'string', description: 'Path to the .kdbx database file.' },
        password: { type: 'string', description: 'Password used to unlock the database.' },
        keyFilePath: { type: 'string', description: 'Optional key file path.' },
        query: { type: 'string', description: 'Text to search for.' },
      },
      required: ['databasePath', 'password', 'query'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (!args || typeof args !== 'object') {
      throw new Error('Tool arguments must be an object.');
    }

    if (name === 'open_database') {
      const databasePath = String(args.databasePath ?? '');
      const password = String(args.password ?? '');
      const keyFilePath = args.keyFilePath ? String(args.keyFilePath) : undefined;

      if (!databasePath) {
        throw new Error('Missing required argument: databasePath');
      }

      const db = await loadDatabase(databasePath, password, keyFilePath);
      return {
        content: [
          {
            type: 'text',
            text: `Opened database: ${databasePath}\nGroups: ${db.groups.length}\nEntries: ${db.getAllEntries().length}`,
          },
        ],
      };
    }

    if (name === 'list_groups') {
      const databasePath = String(args.databasePath ?? '');
      const password = String(args.password ?? '');
      const keyFilePath = args.keyFilePath ? String(args.keyFilePath) : undefined;

      const db = await loadDatabase(databasePath, password, keyFilePath);
      const root = sanitizeGroup(db.groups[0]);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(root, null, 2),
          },
        ],
      };
    }

    if (name === 'search_entries') {
      const databasePath = String(args.databasePath ?? '');
      const password = String(args.password ?? '');
      const query = String(args.query ?? '');
      const keyFilePath = args.keyFilePath ? String(args.keyFilePath) : undefined;

      if (!query) {
        throw new Error('Missing required argument: query');
      }

      const db = await loadDatabase(databasePath, password, keyFilePath);
      const results = db
        .getAllEntries()
        .filter((entry: any) => findEntryMatches(entry, query))
        .map(sanitizeEntry);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unsupported tool: ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('KDBX MCP server started on stdio');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
