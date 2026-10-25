// The bot mayors (spec §11.1–§11.2), shared by the Lab, the tests and the
// page's harness mode. Pure and import-free beyond the engine, like the
// engine itself, so a bot plays the same in Node, a Worker and WebKit.

export { viewOf, type BotView } from './view';
export { BOTS, BOT_IDS, BOT_ALIASES, STYLES, botById, brambleCommands, type BotDef, type BotId, type BotRng, type Policy, type SessionModel, type Style } from './mayors';
export * as planner from './planner';
