import { getText } from './i18n';
import type { Language } from './i18n';
import type { PayloadItem, ToolCommand } from './types';

export interface SearchIndex {
  payloads: readonly PayloadItem[];
  tools: readonly ToolCommand[];
  language: Language;
}

export interface SearchMatches {
  payloadIds: ReadonlySet<string>;
  toolIds: ReadonlySet<string>;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchesText = (value: string | undefined, matcher: RegExp) => Boolean(value && matcher.test(value));

const payloadMatches = (payload: PayloadItem, language: Language, matcher: RegExp) => {
  if (
    matchesText(getText(payload.name, language), matcher)
    || matchesText(getText(payload.description, language), matcher)
    || matchesText(getText(payload.category, language), matcher)
    || matchesText(getText(payload.subCategory, language), matcher)
  ) return true;
  for (const tag of payload.tags) if (matchesText(tag, matcher)) return true;
  for (const item of payload.prerequisites || []) if (matchesText(getText(item, language), matcher)) return true;
  for (const command of payload.execution) {
    if (
      matchesText(getText(command.title, language), matcher)
      || matchesText(getText(command.description, language), matcher)
      || matchesText(command.command, matcher)
    ) return true;
  }
  for (const command of payload.wafBypass || []) {
    if (
      matchesText(getText(command.title, language), matcher)
      || matchesText(getText(command.description, language), matcher)
      || matchesText(command.command, matcher)
    ) return true;
  }
  return false;
};

const toolMatches = (tool: ToolCommand, language: Language, matcher: RegExp) => {
  if (
    matchesText(getText(tool.name, language), matcher)
    || matchesText(getText(tool.description, language), matcher)
    || matchesText(getText(tool.category, language), matcher)
  ) return true;
  for (const command of tool.commands) {
    if (
      matchesText(getText(command.name, language), matcher)
      || matchesText(getText(command.description, language), matcher)
      || matchesText(command.command, matcher)
    ) return true;
  }
  return false;
};

export const buildSearchIndex = (
  payloads: PayloadItem[],
  tools: ToolCommand[],
  language: Language,
): SearchIndex => ({
  payloads,
  tools,
  language,
});

export const matchSearchIndex = (index: SearchIndex, query: string): SearchMatches => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { payloadIds: new Set(), toolIds: new Set() };
  }

  const matcher = new RegExp(escapeRegExp(normalizedQuery), 'iu');
  return {
    payloadIds: new Set(index.payloads
      .filter(payload => payloadMatches(payload, index.language, matcher))
      .map(payload => payload.id)),
    toolIds: new Set(index.tools
      .filter(tool => toolMatches(tool, index.language, matcher))
      .map(tool => tool.id)),
  };
};
