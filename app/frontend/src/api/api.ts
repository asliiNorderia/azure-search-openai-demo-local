const BACKEND_URI = "";

import {
    ChatAppResponse,
    ChatAppResponseOrError,
    ChatAppRequest,
    ConversationRequest,
    ConversationResponse,
    ConversationListResponse,
    AskResponse,
    ChatRequest
} from "./models";
import { useLogin } from "../authConfig";

function getHeaders(idToken: string | undefined): Record<string, string> {
    var headers: Record<string, string> = {
        "Content-Type": "application/json"
    };
    // If using login, add the id token of the logged in account as the authorization
    if (useLogin) {
        if (idToken) {
            headers["Authorization"] = `Bearer ${idToken}`;
        }
    }

    return headers;
}

/* Turned the ChatRequest to ChatAppRequest below*/
export async function chatConversationApi(options: ChatRequest): Promise<AskResponse> {
    console.log("chatConversationApi: options.history: ", options.history);

    const response = await fetch("/conversation/add", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            history: options.history,
            approach: options.approach,
            overrides: {
                semantic_ranker: options.overrides?.semanticRanker,
                semantic_captions: options.overrides?.semanticCaptions,
                top: options.overrides?.top,
                temperature: options.overrides?.temperature,
                prompt_template: options.overrides?.promptTemplate,
                prompt_template_prefix: options.overrides?.promptTemplatePrefix,
                prompt_template_suffix: options.overrides?.promptTemplateSuffix,
                exclude_category: options.overrides?.excludeCategory,
                suggest_followup_questions: options.overrides?.suggestFollowupQuestions
            },
            user: "user", // TODO: add user ID parameter ## BDL: I think we just depend on the backend to capture the authenticated user for now.
            conversation_id: options.conversation_id // TODO: add conversation ID
        })
    });

    const parsedResponse: AskResponse = await response.json();
    if (response.status > 299 || !response.ok) {
        throw Error(parsedResponse.error || "Unknown error");
    }

    return parsedResponse;
}
//BDL proposed updated conversationApi...
// TODO: need to figure out how to better return types as an enum or switch statement or something.
export async function conversationApi(options: any): Promise<any> {
    console.log("conversationApi: options", options);
    // parse the route depending on the task

    let route: string;
    let body;

    switch (options.route) {
        case "/add":
            route = `${options.baseroute}/add`;
            break;
        case "/read":
            route = `${options.baseroute}/read`;
            body = JSON.stringify({ conversation_id: options.conversation_id });
            break;
        case "/list":
            route = `${options.baseroute}/list`;
            body = JSON.stringify({});
            break;
        case "/delete":
            route = `${options.baseroute}/delete`;
            body = JSON.stringify({ conversation_id: options.conversation_id });
            break;

        default:
            throw Error("Invalid route");
    }

    const response = await fetch(route, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: body
    });

    const parsedResponse: any = await response.json();

    if (response.status > 299 || !response.ok) {
        throw Error(parsedResponse.error || "Unknown error");
    }

    return parsedResponse;
}

export async function askApi(request: ChatAppRequest, idToken: string | undefined): Promise<ChatAppResponse> {
    const response = await fetch(`${BACKEND_URI}/ask`, {
        method: "POST",
        headers: getHeaders(idToken),
        body: JSON.stringify(request)
    });

    const parsedResponse: ChatAppResponseOrError = await response.json();
    if (response.status > 299 || !response.ok) {
        throw Error(parsedResponse.error || "Unknown error");
    }

    return parsedResponse as ChatAppResponse;
}

export async function chatApi(request: ChatAppRequest, idToken: string | undefined): Promise<Response> {
    return await fetch(`${BACKEND_URI}/chat`, {
        method: "POST",
        headers: getHeaders(idToken),
        body: JSON.stringify(request)
    });
}

export function getCitationFilePath(citation: string): string {
    return `${BACKEND_URI}/content/${citation}`;
}
