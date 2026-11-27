import {integer} from './values';

export const defaultModelCallLimit = 72;
export const defaultConcurrency = 4;
export const defaultRunCounts = {steps:512, modelCalls:defaultModelCallLimit, toolCalls:48, agents:24};
export const defaultDepth = 8;

export const runConcurrency = (value:unknown) => integer(value, defaultConcurrency, 1, 12);
