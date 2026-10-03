/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiChats from "../aiChats.js";
import type * as apiTokens from "../apiTokens.js";
import type * as calendarEvents from "../calendarEvents.js";
import type * as calendarPull from "../calendarPull.js";
import type * as crons from "../crons.js";
import type * as googleSync from "../googleSync.js";
import type * as graph from "../graph.js";
import type * as http from "../http.js";
import type * as lib_actor from "../lib/actor.js";
import type * as lib_columns from "../lib/columns.js";
import type * as lib_googleCalendar from "../lib/googleCalendar.js";
import type * as lib_googleEvents from "../lib/googleEvents.js";
import type * as lib_googleSync from "../lib/googleSync.js";
import type * as lib_graph from "../lib/graph.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_notesLib from "../lib/notesLib.js";
import type * as lib_recurrence from "../lib/recurrence.js";
import type * as lib_taskHistory from "../lib/taskHistory.js";
import type * as lib_taskNumbers from "../lib/taskNumbers.js";
import type * as notebooks from "../notebooks.js";
import type * as notes from "../notes.js";
import type * as oauth from "../oauth.js";
import type * as projects from "../projects.js";
import type * as syncQueue from "../syncQueue.js";
import type * as tasks from "../tasks.js";
import type * as userPreferences from "../userPreferences.js";
import type * as widgets from "../widgets.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiChats: typeof aiChats;
  apiTokens: typeof apiTokens;
  calendarEvents: typeof calendarEvents;
  calendarPull: typeof calendarPull;
  crons: typeof crons;
  googleSync: typeof googleSync;
  graph: typeof graph;
  http: typeof http;
  "lib/actor": typeof lib_actor;
  "lib/columns": typeof lib_columns;
  "lib/googleCalendar": typeof lib_googleCalendar;
  "lib/googleEvents": typeof lib_googleEvents;
  "lib/googleSync": typeof lib_googleSync;
  "lib/graph": typeof lib_graph;
  "lib/hash": typeof lib_hash;
  "lib/notesLib": typeof lib_notesLib;
  "lib/recurrence": typeof lib_recurrence;
  "lib/taskHistory": typeof lib_taskHistory;
  "lib/taskNumbers": typeof lib_taskNumbers;
  notebooks: typeof notebooks;
  notes: typeof notes;
  oauth: typeof oauth;
  projects: typeof projects;
  syncQueue: typeof syncQueue;
  tasks: typeof tasks;
  userPreferences: typeof userPreferences;
  widgets: typeof widgets;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
