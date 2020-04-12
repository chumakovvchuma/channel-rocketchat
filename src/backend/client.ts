import { driver, methodCache, api } from '@rocket.chat/sdk'
//import Promise from "bluebird";

import * as sdk from 'botpress/sdk'
import _ from 'lodash'

import { Config } from '../config'
import { Clients } from './typings'

const debug = DEBUG('channel-rocketchat')
const debugIncoming = debug.sub('incoming')
const debugOutgoing = debug.sub('outgoing')

const outgoingTypes = ['text', 'image']

// userCache = new LRU({ max: 1000, maxAge: ms('1h') })

export class RocketChatClient {
  private interactive: any
  private logger: sdk.Logger
  private connection : any
  private user : any
  private roomList : any
  private roomsJoined : any
  private subscribed : any
  private connected : boolean

  constructor(private bp: typeof sdk, private botId: string, private config: Config, private router) {
    this.logger = bp.logger.forBot(botId)
    this.connected = false;
  }

  async connect() {

    this.connected = false;
    // split channe string
    function handleChannel(channelList) {
      if (channelList !== undefined) {
        channelList = channelList.replace(/[^\w\,._]/gi, "").toLowerCase();
        if (channelList.match(",")) {
          channelList = channelList.split(",");
        } else if (channelList !== "") {
          channelList = [channelList];
        } else {
          channelList = [];
        }
      }
      return channelList;
    }

    try {
      // connect to Rocket.Chat server
      this.connection =  await driver.connect({
        host: this.config.rocketChatUrl,
        useSsl: this.config.rocketChatUseSSL
      });
      console.log('Connected to Rocket.Chat at ' + this.config.rocketChatUrl);
      // login as Rocket.Chat bot user
      this.user = await driver.login({
        username: this.config.rocketChatBotUser,
        password: this.config.rocketChatBotPassword
      });
      console.log('Logged in Rocket.Chat as ' + this.config.rocketChatBotUser);
      // join to Rocket.Chat rooms
      this.roomList = handleChannel(this.config.rocketChatRoom);
      this.roomsJoined = await driver.joinRooms(this.roomList);
      console.log('joined rooms ' + this.config.rocketChatRoom);
      // subscribe to messages
      this.subscribed = await driver.subscribeToMessages();
      console.log('subscribed to Rocket.Chat messages');
      // sent greeting message to each room
       for (const room of this.roomList) {
          const sent = await driver.sendToRoom( this.config.rocketChatBotUser + ' is listening you ...',room);
      }
      this.connected = true;
    } catch (error) {
      console.log(error);
    }
  }


  // listen to messages  from Rocket.Chat 
  async listen() {

    const self = this

    // Rocket.Chat receive function
    const receiveRocketChatMessages = async function(err, message, meta) {
      try {
        if (!err) {
          // If message have .t so it's a system message, so ignore it
          if (message.t === undefined) {

            const userId = message.u._id;
            const user = await self.bp.users.getOrCreateUser(message.rid, userId);

            debugIncoming('Receiving message %o', message)
            debugIncoming('User %o', user)

            await self.bp.events.sendEvent(
                  self.bp.IO.Event({
                    id: message.ts.$date.toString(),
                    botId: self.botId,
                    channel: 'rocketchat',
                    direction: 'incoming',
                    payload: { text:message.msg, user_info: user },
                    type: 'text',
                    preview: message.msg,
                    target:message.rid
              })
            )
          }
        }
      } catch (error) {
        console.log(error);
      }
    }

    console.log("Listening to Rocket.Chat messages ... ");
    const options = {
      dm: true,
      livechat: true,
      edited: true
    };

    return driver.respondToMessages(receiveRocketChatMessages, options);

  }

  isConnected() {
      return this.connected;
  }

  // disconnect from Rocket.Chat
  async disconnect() {
      await driver.disconnect();
  }


  // send message from Botpress to Rocket.Chat
  sendMessageToRocketChat(event) {
    const msg = event.payload.text;
    const channelId = event.threadId || event.target;

    // TODO - different call to fit rocketChat message type 

    return driver.sendToRoom(msg, channelId);

  }

  // send messages from Botpress to Rocket.Chat 
  async handleOutgoingEvent(event: sdk.IO.Event, next: sdk.IO.MiddlewareNextCallback) {
   
    if (event.type === 'typing') {
      //await this.rtm.sendTyping(event.threadId || event.target)
      await new Promise(resolve => setTimeout(() => resolve(), 1000))
      return next(undefined, false)
    }

    const messageType = event.type === 'default' ? 'text' : event.type
    if (!_.includes(outgoingTypes, messageType)) {
      return next(new Error('Unsupported event type: ' + event.type))
    }

    // sending text
    debugOutgoing('Sending event %o', event)
    console.log("Sending event %o", event);
    await this.sendMessageToRocketChat(event)

    next(undefined, false)

  }


}


// setup Middleware to send outgoing message from Botpress to Rochet.Chat
export async function setupMiddleware(bp: typeof sdk, clients: Clients) {

  bp.events.registerMiddleware({
    description: 'Sends messages to Rocket.Chat',
    direction: 'outgoing',
    handler: outgoingHandler,
    name: 'rocketchat.sendMessages',
    order: 100
  })

  async function outgoingHandler(event: sdk.IO.Event, next: sdk.IO.MiddlewareNextCallback) {
    if (event.channel !== 'rocketchat') {
      return next()
    }

    const client: RocketChatClient = clients[event.botId]
    if (!client) {
      return next()
    }

    return client.handleOutgoingEvent(event, next)
  }

}

