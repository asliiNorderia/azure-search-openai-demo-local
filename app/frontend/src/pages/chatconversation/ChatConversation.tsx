import { useRef, useState, useEffect } from "react";
import { Checkbox, Panel, TextField, SpinButton, PanelType, Dialog, PrimaryButton, DefaultButton } from "@fluentui/react";
import { Stack, IStackTokens } from "@fluentui/react";
import { SparkleFilled } from "@fluentui/react-icons";
import styles from "./ChatConversation.module.css";

import {
    chatConversationApi,
    conversationApi,
    Approaches,
    AskResponse,
    ChatRequest,
    ChatTurn,
    ConversationRequest,
    ConversationResponse,
    BotFrontendFormat,
    ConversationListResponse,
    ChatAppResponse,
    ResponseMessage,
    ResponseContext,
    ResponseChoice
} from "../../api";
import { Answer, AnswerError, AnswerLoading } from "../../components/Answer";
import { QuestionInput } from "../../components/QuestionInput";
import { ChatConversationExampleList } from "../../components/ChatConversationExample";
import { UserChatMessage } from "../../components/UserChatMessage";
import { AnalysisPanel, AnalysisPanelTabs } from "../../components/AnalysisPanel";
import { ConversationListButton, ConversationListRefreshButton, ConversationList } from "../../components/ConversationList";
import { SettingsButton } from "../../components/SettingsButton";
import { ClearChatButton } from "../../components/ClearChatButton";
import { string } from "prop-types";

const ChatConversation = () => {
    const [isConfigPanelOpen, setIsConfigPanelOpen] = useState(false);
    const [isConversationListPanelOpen, setIsConversationListPanelOpen] = useState(false);
    const [promptTemplate, setPromptTemplate] = useState<string>("");
    const [retrieveCount, setRetrieveCount] = useState<number>(3);
    const [useSemanticRanker, setUseSemanticRanker] = useState<boolean>(true);
    const [useSemanticCaptions, setUseSemanticCaptions] = useState<boolean>(false);
    const [excludeCategory, setExcludeCategory] = useState<string>("");
    const [useSuggestFollowupQuestions, setUseSuggestFollowupQuestions] = useState<boolean>(false);

    const lastQuestionRef = useRef<string>("");
    const chatMessageStreamEnd = useRef<HTMLDivElement | null>(null);

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<unknown>();

    const [activeCitation, setActiveCitation] = useState<string>();
    const [activeAnalysisPanelTab, setActiveAnalysisPanelTab] = useState<AnalysisPanelTabs | undefined>(undefined);

    const [selectedAnswer, setSelectedAnswer] = useState<number>(0);
    /* */
    const [answers, setAnswers] = useState<[user: string, response: AskResponse][]>([]);

    const [currentConversationId, setCurrentConversationId] = useState<string>("");
    const [conversationList, setConversationList] = useState<ConversationListResponse | null>(null);
    const [conversationListFetched, setConversationListFetched] = useState(false);
    const [conversationDeleteModalClosed, setConversationDeleteModalClosed] = useState(true);
    const [conversationToDeleteId, setConversationToDeleteId] = useState<string>("");

    //Maps the response from conversations and messages to be rendered in the chat window
    const handleConversationDeleteButtonClicked = (conversation_id: string) => {
        setConversationDeleteModalClosed(false);
        setConversationToDeleteId(conversation_id);
    };

    const handleConversationDeleteModalClose = () => {
        setConversationDeleteModalClosed(true);
        setConversationToDeleteId("");
    };

    const stackTokens = { childrenGap: 10 };

    async function callDeleteConversationAPI(conversation_id: string) {
        try {
            const request: ConversationRequest = {
                conversation_id: conversation_id,
                baseroute: "/conversation",
                route: "/delete"
            };
            const result = await conversationApi(request);
            return result;
        } catch (e) {
            setError(e);
        } finally {
            setIsLoading(false);
        }
    }
    const deleteConversation = (conversation_id: string) => {
        callDeleteConversationAPI(conversation_id)
            .then(result => {
                let conv_id = result.conversation_id;
                console.log(`Conversation ${conv_id} deleted successfully`);
            })
            .then(() => {
                handleConversationDeleteModalClose();
                clearChat();
            })
            .then(() => {
                // refresh the conversation list
                listConversations().then(result => {
                    setConversationList(result || null);
                });
            });
    };

    const renderConverationMessageHistory = (mylist: BotFrontendFormat) => {
        return mylist.map(
            ({ user, bot }, index) =>
                [
                    user,
                    {
                        answer: bot,
                        thoughts: null,
                        data_points: [],
                        conversation_id: ""
                    }
                ] as [string, AskResponse]
        );
    };

    async function getConversationMessages(conversation_id: string) {
        setIsLoading(true);
        try {
            const request: ConversationRequest = {
                conversation_id: conversation_id,
                baseroute: "/conversation",
                route: "/read",
                approach: Approaches.ChatConversation
            };
            const result = await conversationApi(request);
            return result;
        } catch (e) {
            setError(e);
        } finally {
            setIsLoading(false);
        }
    }

    const loadConversation = (conversation_id: string) => {
        // set the current conversation id to the new conversation id
        setCurrentConversationId(conversation_id);

        // load the conversation messages from the api
        getConversationMessages(conversation_id).then(result => {
            // if the result object has a "messages" property
            // format the messages array so it can be rendered in the chat window
            if (result?.messages) {
                let messages = result.messages;
                const formattedAnswers = renderConverationMessageHistory(messages);
                console.log("messages", messages);
                console.log("fomattedMessages", formattedAnswers);
                setAnswers(formattedAnswers);
                lastQuestionRef.current = formattedAnswers[formattedAnswers.length - 1][0];
            } else {
                //log an error
                console.error("There were no messages returned for this conversation: ", conversation_id);
            }
        });

        // trigger a refresh of the chat window with the new conversation
    };

    // list all the conversations for the user
    async function listConversations() {
        try {
            const request: ConversationRequest = {
                baseroute: "/conversation",
                route: "/list"
            };
            const result: ConversationListResponse = await conversationApi(request);
            return result;
        } catch (e) {
            setError(e);
        } finally {
        }
    }

    const makeApiRequest = async (question: string) => {
        lastQuestionRef.current = question;

        error && setError(undefined);
        setIsLoading(true);
        setActiveCitation(undefined);
        setActiveAnalysisPanelTab(undefined);

        try {
            const history: ChatTurn[] = answers.map(a => ({ user: a[0], bot: a[1].answer }));
            const request: ChatRequest = {
                history: [...history, { user: question, bot: undefined }],
                // Change the approach here to route to GPT model
                approach: Approaches.ChatConversation,
                overrides: {
                    promptTemplate: promptTemplate.length === 0 ? undefined : promptTemplate,
                    excludeCategory: excludeCategory.length === 0 ? undefined : excludeCategory,
                    top: retrieveCount,
                    semanticRanker: useSemanticRanker,
                    semanticCaptions: useSemanticCaptions,
                    suggestFollowupQuestions: useSuggestFollowupQuestions
                },
                conversation_id: currentConversationId
            };
            const result = await chatConversationApi(request);
            setAnswers([...answers, [question, result]]);
            setCurrentConversationId(result.conversation_id);
        } catch (e) {
            setError(e);
        } finally {
            setIsLoading(false);
        }
    };

    const clearChat = () => {
        lastQuestionRef.current = "";
        error && setError(undefined);
        setActiveCitation(undefined);
        setActiveAnalysisPanelTab(undefined);
        setAnswers([]);
        setCurrentConversationId("");
    };

    useEffect(() => chatMessageStreamEnd.current?.scrollIntoView({ behavior: "smooth" }), [isLoading]);

    const onPromptTemplateChange = (_ev?: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
        setPromptTemplate(newValue || "");
    };

    const onRetrieveCountChange = (_ev?: React.SyntheticEvent<HTMLElement, Event>, newValue?: string) => {
        setRetrieveCount(parseInt(newValue || "3"));
    };

    const onUseSemanticRankerChange = (_ev?: React.FormEvent<HTMLElement | HTMLInputElement>, checked?: boolean) => {
        setUseSemanticRanker(!!checked);
    };

    const onUseSemanticCaptionsChange = (_ev?: React.FormEvent<HTMLElement | HTMLInputElement>, checked?: boolean) => {
        setUseSemanticCaptions(!!checked);
    };

    const onExcludeCategoryChanged = (_ev?: React.FormEvent, newValue?: string) => {
        setExcludeCategory(newValue || "");
    };

    const onUseSuggestFollowupQuestionsChange = (_ev?: React.FormEvent<HTMLElement | HTMLInputElement>, checked?: boolean) => {
        setUseSuggestFollowupQuestions(!!checked);
    };

    const onExampleClicked = (example: string) => {
        makeApiRequest(example);
    };

    const onShowCitation = (citation: string, index: number) => {
        if (activeCitation === citation && activeAnalysisPanelTab === AnalysisPanelTabs.CitationTab && selectedAnswer === index) {
            setActiveAnalysisPanelTab(undefined);
        } else {
            setActiveCitation(citation);
            setActiveAnalysisPanelTab(AnalysisPanelTabs.CitationTab);
        }

        setSelectedAnswer(index);
    };

    const onToggleTab = (tab: AnalysisPanelTabs, index: number) => {
        if (activeAnalysisPanelTab === tab && selectedAnswer === index) {
            setActiveAnalysisPanelTab(undefined);
        } else {
            setActiveAnalysisPanelTab(tab);
        }

        setSelectedAnswer(index);
    };

    const refreshConversationList = () => {
        listConversations().then(result => {
            setConversationList(result || null);
        });
    };

    const handleConversationListButtonClick = () => {
        setIsConversationListPanelOpen(!isConversationListPanelOpen);
        listConversations().then(result => {
            setConversationList(result || null);
            setConversationListFetched(true); // Set this state to trigger the useEffect
        });
    };

    /* New Functionality Added By Asli*/
    const convertAskResponseToChatAppResponse = (askResponse: AskResponse): ChatAppResponse => {
        const { answer, thoughts, data_points, conversation_id, error } = askResponse;

        const responseMessage: ResponseMessage = {
            content: answer, // Assuming the answer goes into the content property
            role: "role_value" // Set the appropriate role value
        };

        const responseContext: ResponseContext = {
            thoughts,
            data_points,
            followup_questions: null // Set the appropriate followup_questions value
        };

        const responseChoice: ResponseChoice = {
            index: 0, // Set the appropriate index
            message: responseMessage,
            context: responseContext,
            session_state: {} // Set the appropriate session_state
        };

        const chatAppResponse: ChatAppResponse = {
            choices: [responseChoice]
        };

        return chatAppResponse;
    };

    useEffect(() => {
        if (conversationListFetched) {
            console.log("Here's your list of conversations", conversationList);
        }
    }, [conversationListFetched]); // Run the effect when conversationListFetched changes

    return (
        <div className={styles.container}>
            <div className={styles.commandsContainer}>
                <ConversationListButton className={styles.commandButtonLeft} onClick={handleConversationListButtonClick} />
                {/* <ClearChatButton className={styles.commandButtonRight} onClick={clearChat} disabled={!lastQuestionRef.current || isLoading} /> */}
                <ClearChatButton className={styles.commandButtonRight} onClick={clearChat} disabled={false} />
                <SettingsButton className={styles.commandButtonRight} onClick={() => setIsConfigPanelOpen(!isConfigPanelOpen)} />
            </div>
            <div className={styles.chatRoot}>
                <div className={styles.chatContainer}>
                    {!lastQuestionRef.current ? (
                        <div className={styles.chatEmptyState}>
                            {/* <SparkleFilled fontSize={"120px"} primaryFill={"rgba(115, 118, 225, 1)"} aria-hidden="true" aria-label="Chat logo" />
                            <h1 className={styles.chatEmptyStateTitle}>Chat with your data</h1>
                            <h2 className={styles.chatEmptyStateSubtitle}>Ask anything or try an example</h2>
                            <ExampleList onExampleClicked={onExampleClicked} /> */}
                            <ChatConversationExampleList onExampleClicked={onExampleClicked} />
                        </div>
                    ) : (
                        <div className={styles.chatMessageStream}>
                            {answers.map((answer, index) => (
                                <div key={index}>
                                    <UserChatMessage message={answer[0]} />
                                    <div className={styles.chatMessageGpt}>
                                        <Answer
                                            key={index}
                                            answer={convertAskResponseToChatAppResponse(answer[1])}
                                            isSelected={selectedAnswer === index && activeAnalysisPanelTab !== undefined}
                                            onCitationClicked={c => onShowCitation(c, index)}
                                            onThoughtProcessClicked={() => onToggleTab(AnalysisPanelTabs.ThoughtProcessTab, index)}
                                            onSupportingContentClicked={() => onToggleTab(AnalysisPanelTabs.SupportingContentTab, index)}
                                            onFollowupQuestionClicked={q => makeApiRequest(q)}
                                            showFollowupQuestions={useSuggestFollowupQuestions && answers.length - 1 === index}
                                            isStreaming={false}
                                        />
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <>
                                    <UserChatMessage message={lastQuestionRef.current} />
                                    <div className={styles.chatMessageGptMinWidth}>
                                        <AnswerLoading />
                                    </div>
                                </>
                            )}
                            {error ? (
                                <>
                                    <UserChatMessage message={lastQuestionRef.current} />
                                    <div className={styles.chatMessageGptMinWidth}>
                                        <AnswerError error={error.toString()} onRetry={() => makeApiRequest(lastQuestionRef.current)} />
                                    </div>
                                </>
                            ) : null}
                            <div ref={chatMessageStreamEnd} />
                        </div>
                    )}

                    <div className={styles.chatInput}>
                        <QuestionInput clearOnSend placeholder={"Type a message here."} disabled={isLoading} onSend={question => makeApiRequest(question)} />
                    </div>
                </div>

                {answers.length > 0 && activeAnalysisPanelTab && (
                    <AnalysisPanel
                        className={styles.chatAnalysisPanel}
                        activeCitation={activeCitation}
                        onActiveTabChanged={x => onToggleTab(x, selectedAnswer)}
                        citationHeight="810px"
                        answer={convertAskResponseToChatAppResponse(answers[selectedAnswer][1])}
                        activeTab={activeAnalysisPanelTab}
                    />
                )}

                <Panel
                    headerText="Configure answer generation"
                    isOpen={isConfigPanelOpen}
                    isBlocking={false}
                    onDismiss={() => setIsConfigPanelOpen(false)}
                    closeButtonAriaLabel="Close"
                    onRenderFooterContent={() => <DefaultButton onClick={() => setIsConfigPanelOpen(false)}>Close</DefaultButton>}
                    isFooterAtBottom={true}
                >
                    <TextField
                        className={styles.chatSettingsSeparator}
                        defaultValue={promptTemplate}
                        label="Override prompt template"
                        multiline
                        autoAdjustHeight
                        onChange={onPromptTemplateChange}
                    />

                    <SpinButton
                        className={styles.chatSettingsSeparator}
                        label="Retrieve this many documents from search:"
                        min={1}
                        max={50}
                        defaultValue={retrieveCount.toString()}
                        onChange={onRetrieveCountChange}
                    />
                    <TextField className={styles.chatSettingsSeparator} label="Exclude category" onChange={onExcludeCategoryChanged} />
                    <Checkbox
                        className={styles.chatSettingsSeparator}
                        checked={useSemanticRanker}
                        label="Use semantic ranker for retrieval"
                        onChange={onUseSemanticRankerChange}
                    />
                    <Checkbox
                        className={styles.chatSettingsSeparator}
                        checked={useSemanticCaptions}
                        label="Use query-contextual summaries instead of whole documents"
                        onChange={onUseSemanticCaptionsChange}
                        disabled={!useSemanticRanker}
                    />
                    <Checkbox
                        className={styles.chatSettingsSeparator}
                        checked={useSuggestFollowupQuestions}
                        label="Suggest follow-up questions"
                        onChange={onUseSuggestFollowupQuestionsChange}
                    />
                </Panel>
                <Dialog hidden={conversationDeleteModalClosed} onDismiss={handleConversationDeleteModalClose}>
                    <div>
                        <h3>Are you sure you want to delete this conversation?</h3>
                        <Stack horizontal tokens={{ childrenGap: 20 }}>
                            <PrimaryButton
                                onClick={() => {
                                    deleteConversation(conversationToDeleteId);
                                }}
                            >
                                Delete Conversation
                            </PrimaryButton>
                            <DefaultButton onClick={handleConversationDeleteModalClose}>Cancel</DefaultButton>
                            {/* <button onClick={()=>}>Delete</button> */}
                        </Stack>
                    </div>
                </Dialog>
                <Panel
                    headerText="Conversation List"
                    isOpen={isConversationListPanelOpen}
                    type={PanelType.customNear}
                    customWidth="340px"
                    isBlocking={false}
                    onDismiss={() => setIsConversationListPanelOpen(false)}
                    closeButtonAriaLabel="Close"
                    onRenderFooterContent={() => <DefaultButton onClick={() => setIsConversationListPanelOpen(false)}>Close</DefaultButton>}
                    isFooterAtBottom={true}
                >
                    <ConversationListRefreshButton className={styles.commandButton} onClick={refreshConversationList} />
                    <ConversationList
                        listOfConversations={conversationList}
                        onConversationClicked={loadConversation}
                        onDeleteClick={handleConversationDeleteButtonClicked}
                    />
                </Panel>
            </div>
        </div>
    );
};

export default ChatConversation;
