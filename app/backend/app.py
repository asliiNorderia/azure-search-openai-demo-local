import io
import json
import logging
import mimetypes
import os
import time
from pathlib import Path
from typing import AsyncGenerator

from datetime import datetime
from history.cosmosdbservice import CosmosConversationClient
from auth.auth_utils import get_authenticated_user_details
from flask import Flask, request, jsonify

import aiohttp
import openai
from azure.core.exceptions import ResourceNotFoundError
from azure.identity.aio import DefaultAzureCredential
from azure.monitor.opentelemetry import configure_azure_monitor
from azure.search.documents.aio import SearchClient
from azure.storage.blob.aio import BlobServiceClient
from opentelemetry.instrumentation.aiohttp_client import AioHttpClientInstrumentor
from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware
from quart import (
    Blueprint,
    Quart,
    abort,
    current_app,
    jsonify,
    make_response,
    request,
    send_file,
    send_from_directory,
)
from quart_cors import cors

from approaches.chatreadretrieveread import ChatReadRetrieveReadApproach
from approaches.retrievethenread import RetrieveThenReadApproach
from approaches.chatconversation import ChatConversationReadApproach
from core.authentication import AuthenticationHelper


## Logging level for development, set to logging.INFO or logging.DEBUG for more verbose logging
logger = logging.getLogger ('werkzeug') # grabs underlying WSGI logger
logger.setLevel (logging.INFO) # set log level to INFO

app = Flask(__name__)

CONFIG_OPENAI_TOKEN = "openai_token"
CONFIG_CREDENTIAL = "azure_credential"
CONFIG_ASK_APPROACH = "ask_approach"
CONFIG_CHAT_APPROACH = "chat_approach"
CONFIG_BLOB_CONTAINER_CLIENT = "blob_container_client"
CONFIG_AUTH_CLIENT = "auth_client"
CONFIG_SEARCH_CLIENT = "search_client"
ERROR_MESSAGE = """The app encountered an error processing your request.
If you are an administrator of the app, view the full error in the logs. See aka.ms/appservice-logs for more information.
Error type: {error_type}
"""
ERROR_MESSAGE_FILTER = """Your message contains content that was flagged by the OpenAI content filter."""

bp = Blueprint("routes", __name__, static_folder="static")
# Fix Windows registry issue with mimetypes
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")


@bp.route("/")
async def index():
    return await bp.send_static_file("index.html")


# Empty page is recommended for login redirect to work.
# See https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/initialization.md#redirecturi-considerations for more information
@bp.route("/redirect")
async def redirect():
    return ""


@bp.route("/favicon.ico")
async def favicon():
    return await bp.send_static_file("favicon.ico")


@bp.route("/assets/<path:path>")
async def assets(path):
    return await send_from_directory(Path(__file__).resolve().parent / "static" / "assets", path)


# Serve content files from blob storage from within the app to keep the example self-contained.
# *** NOTE *** this assumes that the content files are public, or at least that all users of the app
# can access all the files. This is also slow and memory hungry.
@bp.route("/content/<path>")
async def content_file(path: str):
    # Remove page number from path, filename-1.txt -> filename.txt
    if path.find("#page=") > 0:
        path_parts = path.rsplit("#page=", 1)
        path = path_parts[0]
    logging.info("Opening file %s at page %s", path)
    blob_container_client = current_app.config[CONFIG_BLOB_CONTAINER_CLIENT]
    try:
        blob = await blob_container_client.get_blob_client(path).download_blob()
    except ResourceNotFoundError:
        logging.exception("Path not found: %s", path)
        abort(404)
    if not blob.properties or not blob.properties.has_key("content_settings"):
        abort(404)
    mime_type = blob.properties["content_settings"]["content_type"]
    if mime_type == "application/octet-stream":
        mime_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    blob_file = io.BytesIO()
    await blob.readinto(blob_file)
    blob_file.seek(0)
    return await send_file(blob_file, mimetype=mime_type, as_attachment=False, attachment_filename=path)


def error_dict(error: Exception) -> dict:
    if isinstance(error, openai.error.InvalidRequestError) and error.code == "content_filter":
        return {"error": ERROR_MESSAGE_FILTER}
    return {"error": ERROR_MESSAGE.format(error_type=type(error))}


def error_response(error: Exception, route: str, status_code: int = 500):
    logging.exception("Exception in %s: %s", route, error)
    if isinstance(error, openai.error.InvalidRequestError) and error.code == "content_filter":
        status_code = 400
    return jsonify(error_dict(error)), status_code


@bp.route("/ask", methods=["POST"])
async def ask():
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    request_json = await request.get_json()
    context = request_json.get("context", {})
    auth_helper = current_app.config[CONFIG_AUTH_CLIENT]
    context["auth_claims"] = await auth_helper.get_auth_claims_if_enabled(request.headers)
    try:
        approach = current_app.config[CONFIG_ASK_APPROACH]
        # Workaround for: https://github.com/openai/openai-python/issues/371
        async with aiohttp.ClientSession() as s:
            openai.aiosession.set(s)
            r = await approach.run(
                request_json["messages"], context=context, session_state=request_json.get("session_state")
            )
        return jsonify(r)
    except Exception as error:
        return error_response(error, "/ask")


async def format_as_ndjson(r: AsyncGenerator[dict, None]) -> AsyncGenerator[str, None]:
    try:
        async for event in r:
            yield json.dumps(event, ensure_ascii=False) + "\n"
    except Exception as e:
        logging.exception("Exception while generating response stream: %s", e)
        yield json.dumps(error_dict(e))


@bp.route("/chat", methods=["POST"])
async def chat():
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    request_json = await request.get_json()
    context = request_json.get("context", {})
    auth_helper = current_app.config[CONFIG_AUTH_CLIENT]
    context["auth_claims"] = await auth_helper.get_auth_claims_if_enabled(request.headers)
    try:
        approach = current_app.config[CONFIG_CHAT_APPROACH]
        result = await approach.run(
            request_json["messages"],
            stream=request_json.get("stream", False),
            context=context,
            session_state=request_json.get("session_state"),
        )
        if isinstance(result, dict):
            return jsonify(result)
        else:
            response = await make_response(format_as_ndjson(result))
            response.timeout = None  # type: ignore
            response.mimetype = "application/json-lines"
            return response
    except Exception as error:
        return error_response(error, "/chat")
    
@bp.route("/conversation/add", methods=["POST"])
async def add_conversation():
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user['user_principal_id']
    generate_title = False
    ensure_openai_token()

    approach = request.json["approach"]

    ## check request for conversation_id
    conversation_id = request.json.get("conversation_id", None)

    ## check to see if a conversation title should be generated
    generate_title = request.json.get("generate_title", False)

    try:
        impl = chatconversation_approaches.get(approach)
        if not impl:
            return jsonify({"error": "unknown approach"}), 400
        ## BDL TODO: should all of this conversation history be moved to the parent "approach" class so it can be shared across all approaches?
        # check for the conversation_id, if the conversation is not set, we will create a new one
        if not conversation_id:
            generate_title = True ## if this is a new conversation, we will generate a title
            conversation_dict = cosmos_conversation_client.create_conversation(user_id=user_id)
            conversation_id = conversation_dict['id']

        ## Format the incoming message object in the "chat/completions" messages format
        ## then write it to the conversation history in cosmos
        message_prompt = request.json["history"][-1]["user"]
        msg = {"role": "user", "content": message_prompt}
        resp = cosmos_conversation_client.create_message(
            conversation_id=conversation_id,
            user_id=user_id,
            input_message=msg
        )

        # Submit prompt to Chat Completions for response
        r = impl.run(request.json["history"], request.json.get("overrides") or {})

        ## Format the incoming message object in the "chat/completions" messages format
        ## then write it to the conversation history in cosmos
        msg = {"role": "assistant", "content": r['answer']}
        resp = cosmos_conversation_client.create_message(
            conversation_id=conversation_id,
            user_id=user_id,
            input_message=msg
        )

        if generate_title:
            ## Generate a title for the conversation
            generate_conversation_title(user_id=user_id, conversation_id=conversation_id, overwrite_title=True)

        ## we need to return the conversation_id in the response so the client can keep track of it
        r['conversation_id'] = conversation_id
        # returns the response from the bot
        return jsonify(r)

    except Exception as e:
        logging.exception("Exception in /conversation")
        return jsonify({"error": str(e)}), 500
    
## Conversation routes needed read, delete, update
@bp.route("/conversation/delete", methods=["POST"])
def delete_conversation():
    ## get the user id from the request headers
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user['user_principal_id']

    ## check request for conversation_id
    conversation_id = request.json.get("conversation_id", None)
    if not conversation_id:
        return jsonify({"error": "conversation_id is required"}), 400

    ## delete the conversation messages from cosmos first
    deleted_messages = cosmos_conversation_client.delete_messages(conversation_id, user_id)

    ## Now delete the conversation 
    deleted_conversation = cosmos_conversation_client.delete_conversation(user_id, conversation_id)

    #BDL TODO: add some error handling here
    return jsonify({"message": "Successfully deleted conversation and messages", "conversation_id": conversation_id}), 200

@bp.route("/conversation/update", methods=["POST"])
def update_conversation():
    ## check request for conversation_id
    conversation_id = request.json.get("conversation_id", None)
    return jsonify({"error": "not implemented"}), 501

@bp.route("/conversation/list", methods=["POST"])
def list_conversations():
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user['user_principal_id']

    ## get the conversations from cosmos
    conversations = cosmos_conversation_client.get_conversations(user_id)
    if not conversations:
        return jsonify({"error": f"No conversations for {user_id} were found"}), 404

    ## return the conversation ids

    return jsonify(conversations), 200

@bp.route("/conversation/read", methods=["POST"])
def get_conversation():
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user['user_principal_id']

    ## check request for conversation_id
    conversation_id = request.json.get("conversation_id", None)

    if not conversation_id:
        return jsonify({"error": "conversation_id is required"}), 400

    ## get the conversation object and the related messages from cosmos
    conversation = cosmos_conversation_client.get_conversation(user_id, conversation_id)
    ## return the conversation id and the messages in the bot frontend format
    if not conversation:
        return jsonify({"error": f"Conversation {conversation_id} was not found. It either does not exist or the logged in user does not have access to it."}), 404

    # get the messages for the conversation from cosmos
    conversation_messages = cosmos_conversation_client.get_messages(user_id, conversation_id)
    if not conversation_messages:
        return jsonify({"error": f"No messages for {conversation_id} were found"}), 404

    ## format the messages in the bot frontend format
    messages = format_messages(conversation_messages, input_format='cosmos', output_format='botfrontend')

    return jsonify({"conversation_id": conversation_id, "messages": messages}), 200

## add a route to generate a title for a conversation
@bp.route("/conversation/gen_title", methods=["POST"])
def gen_title():
    ## lookup the conversation in cosmos
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user['user_principal_id']

    ## check request for conversation_id
    conversation_id = request.json.get("conversation_id", None)

    overwrite_existing_title = request.json.get("overwrite_existing_title", False)

    try:
        conversation_title_response_dict = generate_conversation_title(user_id, conversation_id, overwrite_title=overwrite_existing_title)
    except Exception as e:
        return jsonify({"error": f"Error generating title for conversation {conversation_id}: {str(e)}"}), 500
    finally:
        return jsonify(conversation_title_response_dict)


def generate_conversation_title(user_id, conversation_id, overwrite_title=False):
    ## get the conversation from cosmos
    conversation_dict = cosmos_conversation_client.get_conversation(user_id, conversation_id)
    if not conversation_dict:
        ## raise an error
        raise Exception(f"Conversation {conversation_id} was not found. It either does not exist or the logged in user does not have access to it.")

    ## check if the conversation already has a title
    conversation_title = conversation_dict.get('title', None)

    if not overwrite_title and conversation_title:
        raise Exception(f"Conversation {conversation_id} already has a title and overwrite_title flag was set to False.")

    ## otherwise go for it and create the title! 
    ## get the messages for the conversation from cosmos
    conversation_messages = cosmos_conversation_client.get_messages(user_id, conversation_id)
    if not conversation_messages:
        raise Exception(f"No messages for {conversation_id} were found")

    ## generate a title for the conversation
    title = create_conversation_title(conversation_messages)
    conversation_dict['title'] = title
    conversation_dict['updatedAt'] = datetime.utcnow().isoformat()

    ## update the conversation in cosmos
    resp = cosmos_conversation_client.upsert_conversation(conversation_dict)

    return resp


def create_conversation_title(conversation_messages):
    ## make sure the messages are sorted by _ts descending
    messages = format_messages(conversation_messages, input_format='cosmos' ,output_format='chatcompletions')

    title_prompt = 'Summarize the conversation so far into a 4-word or less title. Do not use any quotation marks or punctuation. Respond with a json object in the format {{"title": string}}. Do not include any other commentary or description.'

    messages.append({'role': 'user', 'content': title_prompt})

    ensure_openai_token()

    try:
        ## Submit prompt to Chat Completions for response
        completion = openai.ChatCompletion.create(    
            engine=AZURE_OPENAI_CHATGPT_DEPLOYMENT,
            messages=messages,
            temperature=1,
            max_tokens=64 
        )
        title = json.loads(completion['choices'][0]['message']['content'])['title']

        return title
    except Exception as e:
        return jsonify({"error": f"Error generating title for the conversation: {e}"}), 500

def format_messages(messages, input_format='cosmos', output_format='chatcompletions'):

    if input_format == 'cosmos': 
        ## Convert to the chat/completions format from cosmos
        if output_format == 'chatcompletions':
            chat_messages = [{'role': msg['role'], 'content': msg['content']} for msg in messages]
            return chat_messages
        ## Convert to the bot frontend format from cosmos
        elif output_format == 'botfrontend':
            ## the botfrontend format is pairs of {"user": inputtext, "bot": outputtext}
            ## the cosmos format is a list of messages with a role and content.
            ## form pairs of user and bot messages from the cosmos messages list 

            botfrontend_messages = []
            last_role = None
            for i, message in enumerate(messages):
                if last_role is None:
                    last_role = message['role']
                elif last_role == message['role']:
                    # we have a situation where there are two messages in a row from the same role
                    # this will cause issues with the frontend due to their chosen format
                    # for now, we will just skip the second message
                    last_role = message['role']
                    continue
                if message['role'] == 'user':
                    botfrontend_messages.append({"user": message['content']})
                elif message['role'] == 'assistant':
                    botfrontend_messages[-1]["bot"] = message['content']
                last_role = message['role']            

            return botfrontend_messages



# Send MSAL.js settings to the client UI
@bp.route("/auth_setup", methods=["GET"])
def auth_setup():
    auth_helper = current_app.config[CONFIG_AUTH_CLIENT]
    return jsonify(auth_helper.get_auth_setup_for_client())


@bp.before_request
async def ensure_openai_token():
    if openai.api_type != "azure_ad":
        return
    openai_token = current_app.config[CONFIG_OPENAI_TOKEN]
    if openai_token.expires_on < time.time() + 60:
        openai_token = await current_app.config[CONFIG_CREDENTIAL].get_token(
            "https://cognitiveservices.azure.com/.default"
        )
        current_app.config[CONFIG_OPENAI_TOKEN] = openai_token
        openai.api_key = openai_token.token


@bp.before_app_serving
async def setup_clients():
    # Replace these with your own values, either in environment variables or directly here
    AZURE_STORAGE_ACCOUNT = os.environ["AZURE_STORAGE_ACCOUNT"]
    AZURE_STORAGE_CONTAINER = os.environ["AZURE_STORAGE_CONTAINER"]
    AZURE_SEARCH_SERVICE = os.environ["AZURE_SEARCH_SERVICE"]
    AZURE_SEARCH_INDEX = os.environ["AZURE_SEARCH_INDEX"]
    # Shared by all OpenAI deployments
    OPENAI_HOST = os.getenv("OPENAI_HOST", "azure")
    OPENAI_CHATGPT_MODEL = os.environ["AZURE_OPENAI_CHATGPT_MODEL"]
    OPENAI_EMB_MODEL = os.getenv("AZURE_OPENAI_EMB_MODEL_NAME", "text-embedding-ada-002")
    # Used with Azure OpenAI deployments
    AZURE_OPENAI_SERVICE = os.getenv("AZURE_OPENAI_SERVICE")
    AZURE_OPENAI_CHATGPT_DEPLOYMENT = os.getenv("AZURE_OPENAI_CHATGPT_DEPLOYMENT")
    AZURE_OPENAI_EMB_DEPLOYMENT = os.getenv("AZURE_OPENAI_EMB_DEPLOYMENT")
    # Used only with non-Azure OpenAI deployments
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    OPENAI_ORGANIZATION = os.getenv("OPENAI_ORGANIZATION")
    AZURE_USE_AUTHENTICATION = os.getenv("AZURE_USE_AUTHENTICATION", "").lower() == "true"
    AZURE_SERVER_APP_ID = os.getenv("AZURE_SERVER_APP_ID")
    AZURE_SERVER_APP_SECRET = os.getenv("AZURE_SERVER_APP_SECRET")
    AZURE_CLIENT_APP_ID = os.getenv("AZURE_CLIENT_APP_ID")
    AZURE_TENANT_ID = os.getenv("AZURE_TENANT_ID")
    TOKEN_CACHE_PATH = os.getenv("TOKEN_CACHE_PATH")

    KB_FIELDS_CONTENT = os.getenv("KB_FIELDS_CONTENT", "content")
    KB_FIELDS_SOURCEPAGE = os.getenv("KB_FIELDS_SOURCEPAGE", "sourcepage")

    AZURE_SEARCH_QUERY_LANGUAGE = os.getenv("AZURE_SEARCH_QUERY_LANGUAGE", "en-us")
    AZURE_SEARCH_QUERY_SPELLER = os.getenv("AZURE_SEARCH_QUERY_SPELLER", "lexicon")

    AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION") or "2023-05-15"
    AZURE_COSMOSDB_DATABASE = os.getenv("AZURE_COSMOSDB_DATABASE") or "db_conversation_history"
    AZURE_COSMOSDB_ACCOUNT = os.getenv("AZURE_COSMOSDB_ACCOUNT")
    AZURE_COSMOSDB_CONVERSATIONS_CONTAINER = os.getenv("AZURE_COSMOSDB_CONVERSATIONS_CONTAINER") or "conversations"
    AZURE_COSMOSDB_MESSAGES_CONTAINER = os.getenv("AZURE_COSMOSDB_MESSAGES_CONTAINER") or "messages"
    AZURE_COSMOSDB_ACCOUNT_KEY = os.getenv("AZURE_COSMOSDB_ACCOUNT_KEY") or None

    # Use the current user identity to authenticate with Azure OpenAI, AI Search and Blob Storage (no secrets needed,
    # just use 'az login' locally, and managed identity when deployed on Azure). If you need to use keys, use separate AzureKeyCredential instances with the
    # keys for each service
    # If you encounter a blocking error during a DefaultAzureCredential resolution, you can exclude the problematic credential by using a parameter (ex. exclude_shared_token_cache_credential=True)
    azure_credential = DefaultAzureCredential(exclude_shared_token_cache_credential=True)

    # Set up authentication helper
    auth_helper = AuthenticationHelper(
        use_authentication=AZURE_USE_AUTHENTICATION,
        server_app_id=AZURE_SERVER_APP_ID,
        server_app_secret=AZURE_SERVER_APP_SECRET,
        client_app_id=AZURE_CLIENT_APP_ID,
        tenant_id=AZURE_TENANT_ID,
        token_cache_path=TOKEN_CACHE_PATH,
    )

    # Set up clients for AI Search and Storage
    search_client = SearchClient(
        endpoint=f"https://{AZURE_SEARCH_SERVICE}.search.windows.net",
        index_name=AZURE_SEARCH_INDEX,
        credential=azure_credential,
    )
    blob_client = BlobServiceClient(
        account_url=f"https://{AZURE_STORAGE_ACCOUNT}.blob.core.windows.net", credential=azure_credential
    )
    blob_container_client = blob_client.get_container_client(AZURE_STORAGE_CONTAINER)

    # Used by the OpenAI SDK
    if OPENAI_HOST == "azure":
        openai.api_type = "azure_ad"
        openai.api_base = f"https://{AZURE_OPENAI_SERVICE}.openai.azure.com"
        openai.api_version = "2023-07-01-preview"
        openai_token = await azure_credential.get_token("https://cognitiveservices.azure.com/.default")
        openai.api_key = openai_token.token
        # Store on app.config for later use inside requests
        current_app.config[CONFIG_OPENAI_TOKEN] = openai_token
    else:
        openai.api_type = "openai"
        openai.api_key = OPENAI_API_KEY
        openai.organization = OPENAI_ORGANIZATION

    # Initialize a CosmosDB client with AAD auth and containers
    cosmos_endpoint = f'https://{AZURE_COSMOSDB_ACCOUNT}.documents.azure.com:443/'
    # credential = azure_credential
    if not AZURE_COSMOSDB_ACCOUNT_KEY:
        credential = azure_credential
    else:
        credential = AZURE_COSMOSDB_ACCOUNT_KEY

    cosmos_conversation_client = CosmosConversationClient(
    cosmosdb_endpoint=cosmos_endpoint, 
    credential=credential, 
    database_name=AZURE_COSMOSDB_DATABASE,
    container_name=AZURE_COSMOSDB_CONVERSATIONS_CONTAINER
    )

    current_app.config[CONFIG_CREDENTIAL] = azure_credential
    current_app.config[CONFIG_SEARCH_CLIENT] = search_client
    current_app.config[CONFIG_BLOB_CONTAINER_CLIENT] = blob_container_client
    current_app.config[CONFIG_AUTH_CLIENT] = auth_helper

    # Various approaches to integrate GPT and external knowledge, most applications will use a single one of these patterns
    # or some derivative, here we include several for exploration purposes
    current_app.config[CONFIG_ASK_APPROACH] = RetrieveThenReadApproach(
        search_client,
        OPENAI_HOST,
        AZURE_OPENAI_CHATGPT_DEPLOYMENT,
        OPENAI_CHATGPT_MODEL,
        AZURE_OPENAI_EMB_DEPLOYMENT,
        OPENAI_EMB_MODEL,
        KB_FIELDS_SOURCEPAGE,
        KB_FIELDS_CONTENT,
        AZURE_SEARCH_QUERY_LANGUAGE,
        AZURE_SEARCH_QUERY_SPELLER,
    )

    current_app.config[CONFIG_CHAT_APPROACH] = ChatReadRetrieveReadApproach(
        search_client,
        OPENAI_HOST,
        AZURE_OPENAI_CHATGPT_DEPLOYMENT,
        OPENAI_CHATGPT_MODEL,
        AZURE_OPENAI_EMB_DEPLOYMENT,
        OPENAI_EMB_MODEL,
        KB_FIELDS_SOURCEPAGE,
        KB_FIELDS_CONTENT,
        AZURE_SEARCH_QUERY_LANGUAGE,
        AZURE_SEARCH_QUERY_SPELLER,
    )

    current_app.config[CONFIG_CHAT_APPROACH] = ChatConversationReadApproach(
        AZURE_OPENAI_CHATGPT_DEPLOYMENT,
    )



def create_app():
    app = Quart(__name__)
    app.register_blueprint(bp)

    if os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING"):
        configure_azure_monitor()
        # This tracks HTTP requests made by aiohttp:
        AioHttpClientInstrumentor().instrument()
        # This middleware tracks app route requests:
        app.asgi_app = OpenTelemetryMiddleware(app.asgi_app)  # type: ignore[method-assign]

    # Level should be one of https://docs.python.org/3/library/logging.html#logging-levels
    #default_level = "INFO"  # In development, log more verbosely
    default_level = "DEBUG"  # In development, log more verbosely
    if os.getenv("WEBSITE_HOSTNAME"):  # In production, don't log as heavily
        default_level = "WARNING"
    logging.basicConfig(level=os.getenv("APP_LOG_LEVEL", default_level))

    if allowed_origin := os.getenv("ALLOWED_ORIGIN"):
        app.logger.info("CORS enabled for %s", allowed_origin)
        cors(app, allow_origin=allowed_origin, allow_methods=["GET", "POST"])
    return app
