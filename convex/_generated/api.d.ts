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
import type * as googleConnections from "../googleConnections.js";
import type * as lib_actor from "../lib/actor.js";
import type * as lib_recurrence from "../lib/recurrence.js";
import type * as projects from "../projects.js";
import type * as syncQueue from "../syncQueue.js";
import type * as tasks from "../tasks.js";
import type * as userPreferences from "../userPreferences.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiChats: typeof aiChats;
  apiTokens: typeof apiTokens;
  calendarEvents: typeof calendarEvents;
  googleConnections: typeof googleConnections;
  "lib/actor": typeof lib_actor;
  "lib/recurrence": typeof lib_recurrence;
  projects: typeof projects;
  syncQueue: typeof syncQueue;
  tasks: typeof tasks;
  userPreferences: typeof userPreferences;
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
