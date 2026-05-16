/**
 * 企业微信渠道类型定义
 *
 * 模板卡片解析器等相关模块的内部类型。
 * 与 openclaw/plugin-sdk 的类型独立。
 */

// ============================================================================
// 模板卡片类型
// ============================================================================

/** 从文本中提取的模板卡片 */
export interface ExtractedTemplateCard {
  /** 原始 JSON 对象（已验证 card_type 合法） */
  cardJson: Record<string, unknown>;
  /** card_type 值 */
  cardType: string;
}

/** extractTemplateCards 返回值 */
export interface TemplateCardExtractionResult {
  /** 提取到的合法模板卡片列表 */
  cards: ExtractedTemplateCard[];
  /** 移除卡片代码块后的剩余文本 */
  remainingText: string;
}

// ============================================================================
// 消息状态类型
// ============================================================================

/** 消息状态（WebSocket 模式） */
export interface MessageState {
  accumulatedText: string;
  streamId?: string;
  hasMedia?: boolean;
  hasMediaFailed?: boolean;
  mediaErrorSummary?: string;
  streamExpired?: boolean;
  hasTemplateCard?: boolean;
}
