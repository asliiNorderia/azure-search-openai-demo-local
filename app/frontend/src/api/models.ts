export const enum Approaches {
    RetrieveThenRead = "rtr",
    ReadRetrieveRead = "rrr",
    ReadDecomposeAsk = "rda",
    ChatConversation = "chatconversation"
}

export type AskRequestOverrides = {
    semanticRanker?: boolean;
    semanticCaptions?: boolean;
    excludeCategory?: string;
    top?: number;
    temperature?: number;
    promptTemplate?: string;
    promptTemplatePrefix?: string;
    promptTemplateSuffix?: string;
    suggestFollowupQuestions?: boolean;
};

export type AskRequest = {
    question: string;
    approach: Approaches;
    overrides?: AskRequestOverrides;
};

export type ChatTurn = {
    user: string;
    bot?: string;
};

export const enum RetrievalMode {
    Hybrid = "hybrid",
    Vectors = "vectors",
    Text = "text"
}

export type ChatRequest = {
    history: ChatTurn[];
    approach: Approaches;
    overrides?: AskRequestOverrides;
    conversation_id?: string;
};

export type ChatAppRequestOverrides = {
    retrieval_mode?: RetrievalMode;
    semantic_ranker?: boolean;
    semantic_captions?: boolean;
    exclude_category?: string;
    top?: number;
    temperature?: number;
    prompt_template?: string;
    prompt_template_prefix?: string;
    prompt_template_suffix?: string;
    suggest_followup_questions?: boolean;
    use_oid_security_filter?: boolean;
    use_groups_security_filter?: boolean;
};

export type ResponseMessage = {
    content: string;
    role: string;
};

export type ResponseContext = {
    thoughts: string | null;
    data_points: string[];
    followup_questions: string[] | null;
};

export type ResponseChoice = {
    index: number;
    message: ResponseMessage;
    context: ResponseContext;
    session_state: any;
};

export type ChatAppResponseOrError = {
    choices?: ResponseChoice[];
    error?: string;
};

export type ChatAppResponse = {
    choices: ResponseChoice[];
};

export type AskResponse = {
    answer: string;
    thoughts: string | null;
    data_points: string[];
    conversation_id: string;
    error?: string;
};

export type ChatAppRequestContext = {
    overrides?: ChatAppRequestOverrides;
};

export type ChatAppRequest = {
    messages: ResponseMessage[];
    context?: ChatAppRequestContext;
    stream?: boolean;
    session_state: any;
};

//BDL: for interacting with conversations
export type ChatCompletionsFormat = [
    {
        role: "system" | "user" | "assistant";
        content: string;
    }
];
export type BotFrontendFormat = [{ user: string; bot: string }];

export type ConversationRequest = {
    baseroute: "/conversation";
    route: "/add" | "/read" | "/delete" | "/update" | "/list";
    conversation_id?: string | null;
    approach?: Approaches;
};

export type ConversationResponse = {
    conversation_id: string;
    messages: BotFrontendFormat;
    error?: string;
};

export type ConversationListResponse = {
    _attachments: string;
    _etag: string;
    _rid: string;
    _self: string;
    _ts: Number;
    createdAt: string;
    id: string;
    summary: string;
    title: string;
    type: "conversation";
    updatedAt: string;
    userId: string;
}[];
