/**
 * WeCom 消息类型定义
 * Bot 和 Agent 模式共用
 */

/**
 * Bot 模式入站消息基础结构 (JSON)
 */
/**
 * **WeComBotInboundBase (Bot 入站消息基类)**
 * 
 * Bot 模式下 JSON 格式回调的基础字段。
 * @property msgid 消息 ID
 * @property aibotid 机器人 ID
 * @property chattype 会话类型: "single" | "group"
 * @property chatid 群聊 ID (仅群组时存在)
 * @property response_url 下行回复 URL (用于被动响应转主动推送)
 * @property from 发送者信息
 */
export type WeComBotInboundBase = {
    msgid?: string;
    aibotid?: string;
    chattype?: "single" | "group";
    chatid?: string;
    response_url?: string;
    from?: { userid?: string; corpid?: string };
    msgtype?: string;
    /** 附件数量 (部分消息存在) */
    attachment_count?: number;
};

export type WeComBotInboundText = WeComBotInboundBase & {
    msgtype: "text";
    text?: { content?: string };
    quote?: WeComInboundQuote;
};

export type WeComBotInboundVoice = WeComBotInboundBase & {
    msgtype: "voice";
    voice?: { content?: string };
    quote?: WeComInboundQuote;
};

export type WeComBotInboundVideo = WeComBotInboundBase & {
    msgtype: "video";
    video?: { url?: string; aeskey?: string };
    quote?: WeComInboundQuote;
};

export type WeComBotInboundStreamRefresh = WeComBotInboundBase & {
    msgtype: "stream";
    stream?: { id?: string };
};

export type WeComBotInboundEvent = WeComBotInboundBase & {
    msgtype: "event";
    create_time?: number;
    event?: {
        eventtype?: string;
        template_card_event?: {
            card_type?: string;
            event_key?: string;
            task_id?: string;
            selected_items?: {
                selected_item?: Array<{
                    question_key?: string;
                    option_ids?: {
                        option_id?: string[];
                    };
                }>;
            };
        };
        /** 权限变更事件回调（如文档授权） */
        auth_change_event?: {
            /** 当前权限列表：1-新建和编辑文档；2-获取成员文档内容 */
            auth_list?: number[];
        };
        [key: string]: unknown;
    };
};

/**
 * **WeComInboundQuote (引用消息)**
 * 
 * 消息中引用的原始内容（如回复某条消息）。
 * 支持引用文本、图片、混合类型、语音、文件等。
 */
export type WeComInboundQuote = {
    msgtype?: "text" | "image" | "mixed" | "voice" | "file" | "video";
    /** 引用文本内容 */
    text?: { content?: string };
    /** 引用图片 URL */
    image?: { url?: string };
    /** 引用混合消息 (图文) */
    mixed?: {
        msg_item?: Array<{
            msgtype: "text" | "image";
            text?: { content?: string };
            image?: { url?: string };
        }>;
    };
    /** 引用语音 */
    voice?: { content?: string };
    /** 引用文件 */
    file?: { url?: string };
    /** 引用视频 */
    video?: { url?: string };
};

export type WeComBotInboundMessage =
    | WeComBotInboundText
    | WeComBotInboundVoice
    | WeComBotInboundVideo
    | WeComBotInboundStreamRefresh
    | WeComBotInboundEvent
    | (WeComBotInboundBase & { quote?: WeComInboundQuote } & Record<string, unknown>);

/**
 * Agent 模式入站消息结构 (解析自 XML)
 */
/**
 * **WeComAgentInboundMessage (Agent 入站消息)**
 * 
 * Agent 模式下解析自 XML 的扁平化消息结构。
 * 键名保持 PascalCase (如 `ToUserName`)。
 */
export type WeComAgentInboundMessage = {
    ToUserName?: string;
    FromUserName?: string;
    CreateTime?: number;
    MsgType?: string;
    MsgId?: string;
    AgentID?: number;
    // 文本消息
    Content?: string;
    // 图片消息
    PicUrl?: string;
    MediaId?: string;
    // 文件消息
    FileName?: string;
    // 语音消息
    Format?: string;
    Recognition?: string;
    // 视频消息
    ThumbMediaId?: string;
    // 位置消息
    Location_X?: number;
    Location_Y?: number;
    Scale?: number;
    Label?: string;
    // 链接消息
    Title?: string;
    Description?: string;
    Url?: string;
    // 事件消息
    Event?: string;
    EventKey?: string;
    // 群聊
    ChatId?: string;
};

/**
 * 模板卡片类型
 */
/**
 * **WeComTemplateCard (模板卡片)**
 * 
 * 复杂的交互式卡片结构。
 * @property card_type 卡片类型: "text_notice" | "news_notice" | "button_interaction" ...
 * @property source 来源信息
 * @property main_title 主标题
 * @property sub_title_text 副标题
 * @property horizontal_content_list 水平排列的键值列表
 * @property button_list 按钮列表
 */
export type WeComTemplateCard = {
    card_type: "text_notice" | "news_notice" | "button_interaction" | "vote_interaction" | "multiple_interaction";
    source?: { icon_url?: string; desc?: string; desc_color?: number };
    main_title?: { title?: string; desc?: string };
    task_id?: string;
    button_list?: Array<{ text: string; style?: number; key: string }>;
    sub_title_text?: string;
    horizontal_content_list?: Array<{
        keyname: string;
        value?: string;
        type?: number;
        url?: string;
        userid?: string;
    }>;
    card_action?: { type: number; url?: string; appid?: string; pagepath?: string };
    action_menu?: { desc: string; action_list: Array<{ text: string; key: string }> };
    select_list?: Array<{
        question_key: string;
        title?: string;
        selected_id?: string;
        option_list: Array<{ id: string; text: string }>;
    }>;
    submit_button?: { text: string; key: string };
    checkbox?: {
        question_key: string;
        option_list: Array<{ id: string; text: string; is_checked?: boolean }>;
        mode?: number;
    };
};

/**
 * 出站消息类型
 */
export type WeComOutboundMessage =
    | { msgtype: "text"; text: { content: string } }
    | { msgtype: "markdown"; markdown: { content: string } }
    | { msgtype: "template_card"; template_card: WeComTemplateCard };
