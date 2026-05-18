/**
 * Backward-compatible type bridge.
 * Canonical definitions live in `src/types/*`.
 */
export type {
  WeComDmConfig,
  WeComAccountConfig,
  WeComConfig,
  ResolvedWeComAccount,
  WeComInboundQuote,
  WeComTemplateCard,
  WeComOutboundMessage,
} from "./types/index.js";

import type {
  WeComBotInboundBase,
  WeComBotInboundText,
  WeComBotInboundVoice,
  WeComBotInboundStreamRefresh,
  WeComBotInboundEvent,
  WeComBotInboundMessage,
} from "./types/index.js";

export type WeComInboundBase = WeComBotInboundBase;
export type WeComInboundText = WeComBotInboundText;
export type WeComInboundVoice = WeComBotInboundVoice;
export type WeComInboundStreamRefresh = WeComBotInboundStreamRefresh;
export type WeComInboundEvent = WeComBotInboundEvent;
export type WeComInboundMessage = WeComBotInboundMessage;

export type WeComInboundTemplateCardEvent = WeComBotInboundEvent;
export type WeComTemplateCardEventPayload = {
  card_type: string;
  event_key: string;
  task_id: string;
  response_code?: string;
  selected_items?: {
    question_key?: string;
    option_ids?: string[];
  };
};
