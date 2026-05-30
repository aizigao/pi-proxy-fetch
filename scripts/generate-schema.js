#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMA_VERSION = "1.0.0";

const schema = {
  $schema: "https://json-schema.org/draft-07/schema#",
  $id: "https://github.com/aizigao/pi-proxy-fetch/schema.json",
  title: "pi-proxy-fetch Config",
  description: "Configuration schema for @aizigao/pi-proxy-fetch proxy.jsonc",
  type: "object",
  required: ["enabled", "profile_name", "profileConfig"],
  additionalProperties: false,
  properties: {
    enabled: {
      type: "boolean",
      description: "Global ON/OFF switch.",
    },
    profile_name: {
      type: "string",
      description:
        'Currently active profile name. Reserved: "direct" (no proxy), "system" (system proxy).\n' +
        "Other values must match a name in profileConfig.",
      examples: ["direct", "system", "auto switch"],
      default: "auto switch",
    },
    profileConfig: {
      type: "array",
      description: "List of proxy profiles.",
      items: {
        oneOf: [
          {
            $ref: "#/definitions/ProxyServerProfile",
          },
          {
            $ref: "#/definitions/AutoSwitchProfile",
          },
        ],
      },
    },
  },

  definitions: {
    ProxyServerProfile: {
      title: "Proxy Server Profile",
      type: "object",
      required: ["name", "type"],
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description: "Unique profile identifier.",
        },
        type: {
          type: "string",
          const: "proxy_server",
        },
        server: {
          type: "string",
          description: "Proxy URL (e.g. socks5://127.0.0.1:7890).",
        },
      },
    },

    AutoSwitchProfile: {
      title: "Auto Switch Profile",
      type: "object",
      required: ["name", "type", "switchRules"],
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description: "Unique profile identifier.",
        },
        type: {
          type: "string",
          const: "autoSwitch",
        },
        ruleListURL: {
          type: "string",
          description: "Remote rule list URL (reserved for future use).",
        },
        switchRules: {
          type: "array",
          description: "Ordered list of switch rules. First match wins.",
          items: {
            $ref: "#/definitions/SwitchRule",
          },
        },
      },
    },

    SwitchRule: {
      title: "Switch Rule",
      type: "object",
      required: ["profileName"],
      additionalProperties: false,
      properties: {
        note: {
          type: "string",
          description: "Optional comment.",
        },
        conditions: {
          type: "array",
          description:
            "Condition list (AND logic). Empty or omitted = always match.",
          items: {
            $ref: "#/definitions/SwitchCondition",
          },
        },
        profileName: {
          type: "string",
          description:
            'Target profile when rule matches. Reserved: "direct", "system".\n' +
            "Other values must match a profile name in profileConfig.",
          examples: ["direct", "system"],
        },
      },
    },

    SwitchCondition: {
      title: "Switch Condition",
      type: "object",
      required: ["conditionType"],
      additionalProperties: false,
      properties: {
        conditionType: {
          type: "string",
          enum: [
            "HostWildcardCondition",
            "UrlWildcardCondition",
            "UrlRegexCondition",
            "DisabledCondition",
          ],
        },
        pattern: {
          type: "string",
          description:
            'Pattern string. Not required for DisabledCondition. Wildcard syntax (*, ?) or JS regex.',
        },
      },
    },
  },
};

const outPath = join(__dirname, "..", "schema.json");
writeFileSync(outPath, JSON.stringify(schema, null, 2) + "\n", "utf8");
console.log(`schema.json written (version ${SCHEMA_VERSION})`);
