
let cachedAccessToken = null;
let expiresAt = 0;
let accessTokenDbId = "CachedTokenDynamoDB";
const EBAY_API = "https://api.ebay.com";

const timeInMiliseconds = function () {return Date.now();};
const timeInSeconds = function () {return Math.floor(Date.now() / 1000);};
//DynamoDB Part
import { DynamoDBClient, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand, TransactWriteCommand} from "@aws-sdk/lib-dynamodb";
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);


const ddb = new DynamoDBClient({ region: "us-east-1" });
//const TABLE = "EbayFirstClassNotification";
const TABLE_Notification_Hashing = "PublicEbayAutomessage_NotificationHashing";
const TABLE_UserAuth = "PublicEbayAutomessage_EbayToken";
const TABLE_UserConfig = "PublicEbayAutomessage_UserFunctionConfig";


async function refreshAccessToken(refresh_token) {
  console.log ("DEBUG refresh_token: ", refresh_token);
  const encodedAuthorization = "Basic " + (await Buffer.from(process.env.CLIENT_ID + ":" + process.env.CLIENT_SECRET).toString("base64"));
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization":
        encodedAuthorization
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh_token
    })
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(data);
    throw new Error("Failed to refresh token");
  }
  return data;
}

async function getAccessToken(EbayUserID) {
  //Simply sanity check by reading past token and check last update time, if less than 30 minutes then API Gateway Authorization Caching is not working.
  const result = await ddb.send(new GetItemCommand({
    TableName: TABLE_UserAuth,
    Key: {EbayUserID: { S: EbayUserID }},
    ProjectionExpression: "EbayUserID, AccessToken, RefreshToken, UpdatedAt"
  }));
  // User is a valid user, so 100% item must exist.
  console.log ("DEBUG result.Item.EbayUserID: ", result.Item.EbayUserID);
  if (!!result.Item) // true = exists, false = not found
  { 
    //Sanity checking the UpdatedAt values to see if it's less than 30 minutes or not
    if (Date.now() - Number(result.Item.UpdatedAt.N) < 90 * 60 * 1000)
    {
      console.log ("Access Token already cached in database (90 minutes), returning it.");
      let cachedAccessToken = result.Item.AccessToken.S;
      return cachedAccessToken;
    }
  };
  console.log ("Calling refreshAccessToken");
  const token = await refreshAccessToken(result.Item.RefreshToken.S);
  let newAccessToken = token.access_token;
  //Write back to DB, no await needed cuz we big dicks
  await ddb.send(new PutItemCommand({
      TableName: TABLE_UserAuth,
      Item: {
          EbayUserID: { S: EbayUserID},
          RefreshToken: {S: result.Item.RefreshToken.S},
          AccessToken: { S: newAccessToken},
          UpdatedAt: { N: Date.now().toString()}
      }
    }));
  return newAccessToken;
}


async function getReadStatus (buyerUsername, itemId, accessToken)
{
  let urlParam = new URLSearchParams({
    reference_id: itemId,
    other_party_username: buyerUsername,
    reference_type: "LISTING",
    //conversation_type: "FROM_MEMBERS" //Neu uncomment this would work normal with other accounts,
                                        // but works weird when username has dash in it.
  });
  const res = await fetch(`https://api.ebay.com/commerce/message/v1/conversation?${urlParam.toString()}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    }
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(data);
    throw new Error("Failed to getReadStatus");;
  };
  return [data.conversations[0]?.latestMessage?.readStatus ?? -1, data.conversations[0]?.conversationId ?? -1];
};
async function setReadStatus (conversationId, accessToken, readStatus)
{
  const res = await fetch("https://api.ebay.com/commerce/message/v1/update_conversation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },//new URLSearchParams({
    body: JSON.stringify({
      conversationId : conversationId,
      conversationType: "FROM_MEMBERS",
      read: readStatus
    })
  });
  const data = await res;//.json();
  if (!res.ok) {
    console.error(data);
    throw new Error("Failed to setReadStatus");;
  };
  console.log ("setReadStatus function call: ", data);
  return 0;
};
/*
  let getReadStatusPromise = getReadStatus (buyerUsername, lineItemId, accessToken).catch(err => {console.error(err);return [null, null];});
  let  [readStatus, convoId] = await getReadStatusPromise; //Can't put these under sendTextMessage, there might be collision.
  let response;
  if (buyerUsername == "mimi-huynh")
  {
    console.log ("mimi-huynh, skipping sending message");
    response = [null, "Debug mode, not actually sending message."];
  } else  {    response = await sendTextMessage (lineItemId, buyerUsername, messageContent, accessToken);  };
  if (readStatus !== null)
  {
    if ((readStatus == 0) || (buyerUsername == "mimi-huynh")) //true = conversation viewed, false = unread.
    {
      console.log ("Convo was unread, so setting it back to unread after message sent");
      await setReadStatus(convoId, accessToken, "false"); //If set true, conversation update to 'read', if false, conversation update to 'unread'.
    } else  {
      console.log ("Convo was already read or not exist, not changing anything.");
    }
  };*/
/*async function sendTextMessage (itemId, buyerUsername, messageContent, accessToken){
  console.log ("Empty sendTextMessage for debugging.");
};
async function sendTextReply (conversationID, buyerUsername, messageContent, accessToken){
  console.log ("Empty sendTextReply for debugging.");
};*/

async function sendTextMessage (itemId, buyerUsername, messageContent, accessToken){
  messageContent = messageContent.replaceAll("\\n", "&#10;");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <AddMemberMessageAAQToPartnerRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <RequesterCredentials>
      <eBayAuthToken>${accessToken}</eBayAuthToken>
    </RequesterCredentials>
    <ItemID>${itemId}</ItemID>
    <MemberMessage>
      <Body> ${messageContent} </Body>
      <QuestionType>General</QuestionType>
      <RecipientID>${buyerUsername}</RecipientID>
    </MemberMessage>
  </AddMemberMessageAAQToPartnerRequest>`;
  const res = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
          'Content-Type': 'text/xml',
          'X-EBAY-API-CALL-NAME': 'AddMemberMessageAAQToPartner',
          'X-EBAY-API-SITEID': '0',
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967'
      },
      body: xml
  });
  const text = await res.text();
  return [res, text];
}
async function sendTextReply (conversationID, buyerUsername, messageContent, accessToken){
  const res = await fetch(
    `${EBAY_API}/commerce/message/v1/send_message`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "conversationId": conversationID,
        "messageText": messageContent
      })
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay API error: ${text}`);
  }
  return res.text();
};


async function getOrderData (orderId, accessToken)
{
  const res = await fetch(
    `${EBAY_API}/sell/fulfillment/v1/order/${orderId}`,
    {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay API error: ${text}`);
  }
  const OrderData = await res.json();
  //console.log ("OrderData \: ", OrderData);
  return OrderData;
}

async function AutoMessageOnShippingConfirmation (userFunctionParameter, parsed_body, recipientUsername, recipientUserID, accessTokenPromise){
  /*
    "data": {
      "itemMarkedShipped": {
        "trackingNumber": null,
        "carrier": null,
        "shippedDate": "2026-07-02T23:09:57.000-04:00",
        "orderId": "14-14836-70653",
        "itemId": 286927594550,
        "transactionId": 10083032987314,
        "lineItemId": "286927594550-10083032987314",
        "publicUserId": 2563054206,
        "username": "zahuynh"
      }
    }*/
  const { topic } = parsed_body.metadata;
  const { data } = parsed_body.notification;
  // Somehow Ebay notification does not include tracking information I guess, so this part is not enough, has to check after fetching the OrderData below.
  if (data.itemMarkedShipped.trackingNumber != null)
  {
    console.log ("Tracking number exist, not sending message.");
    return;
  };
  const allowedShippingMethods = userFunctionParameter.allowed_Shipping_Methods;

  // 0) Từ EbayUserID lấy refreshToken/AccessToken từ PublicEbayAutomessage_EbayToken, check if expired, fetch Ebay lấy AccessToken mới,  ghi ngược vào Database.
  //const AccessToken = await getAccessToken(recipientUserID);
  const AccessToken = await accessTokenPromise;

  // 2) Fetch Transaction về.
  const OrderData = await getOrderData (data.itemMarkedShipped.orderId, AccessToken);   
  console.log ("OrderData: ", JSON.stringify(OrderData, null, 2));
  const BuyerUsername = OrderData.buyer?.username; // 3) Extract username người nhận hàng từ fetch đó.

  if (!allowedShippingMethods.includes(OrderData.fulfillmentStartInstructions[0].shippingStep.shippingServiceCode))
  {
    console.log ("Shipping Method not recognized, skipping");
    return;
  };

  // 5) Gửi tin nhắn báo người dùng.
  const currentHour = new Date().getHours(); // 0-23, UTC time, so Virginia time add 4.
  let messageContent;
  if (currentHour < userFunctionParameter.CutoffTime)
    {messageContent = userFunctionParameter.MessageBeforeCutoff}
  else {messageContent = userFunctionParameter.MessageAfterCutoff};
  //Kiểm tra Hash xem tin nhắn đã gửi chưa, idotempocy gì đấy.
  const checkHashResult = await checkHashDatabase(BuyerUsername, messageContent);
  if (!checkHashResult)
  {
    console.log ("Message already exist in hash db (so already sent then), not sending again.");
    return;
  };
  await sendTextMessage (OrderData.lineItems[0].legacyItemId, BuyerUsername, messageContent, AccessToken);
};
async function AutoMessageOnOrderItemID (userFunctionParameter, parsed_body, recipientUsername, recipientUserID, accessTokenPromise)
{
  const { topic } = parsed_body.metadata;
  const { data } = parsed_body.notification;
  console.log ("DEBUG: OrderID: ", data.order.orderId);
  const AccessToken = await accessTokenPromise;

  
  //const legacyItemIds = OrderData.lineItems.map(item => parseInt(item.legacyItemId)); //No need to GetOrder this early, the notification already included the item id.
  const legacyItemIds = data.order.orderLineItems.map(item => parseInt(item.listingId));
  let union = [...new Set([...(legacyItemIds ?? []), ...(userFunctionParameter.ListingIDs??[])])];
  let intersection = legacyItemIds.filter(Set.prototype.has, new Set(userFunctionParameter.ListingIDs));
  console.log("OG legacyItemIds: ", legacyItemIds, ", Filtering ListingIDs: ", userFunctionParameter.ListingIDs,", Intersection:", intersection, );
  if (intersection.length === 0) {
    console.log ("ListingID not match, skipping");
    return;
  };

  const OrderData = await getOrderData (data.order.orderId, AccessToken);  //console.log ("OrderData: ", JSON.stringify(OrderData, null, 2));
  const BuyerUsername = OrderData.buyer?.username; // 3) Extract username người nhận hàng từ fetch đó.
  const messageContent = userFunctionParameter.MessageContent;
  const checkHashResult = await checkHashDatabase(BuyerUsername, messageContent);
  if (!checkHashResult)
  {
    console.log ("Message already exist in hash db (so already sent then), not sending again.");
    return;
  };
  await sendTextMessage (OrderData.lineItems[0].legacyItemId, BuyerUsername, messageContent, AccessToken);
}
async function AutoMessageOnOrderShippingMethod (userFunctionParameter, parsed_body, recipientUsername, recipientUserID, accessTokenPromise){
  /*parsed_body.notification:  {
  notificationId: 'a961f77d-17e4-4dc4-9636-f5bead81a2c2_a28994df-4afd-4a91-b163-efa7aa1d1bfa',
  eventDate: '2026-07-08T21:41:17.849Z',
  publishDate: '2026-07-08T21:50:18.444Z',
  publishAttemptCount: 3,
  data: {
    user: { userId: 'mdcmy3lmqm6', username: 'zahuynh' },
    order: { orderId: '06-14879-94516', orderLineItems: [Array] }
  
  }  },
  userFunctionParameter:  {
  allowed_Shipping_Methods: [ 'USPSFirstClassLetter', 'USPSFirstClassLargeEnvelop' ],
  MssgOnUsaOrder: '[Reply SHIPPING for more details]',
  MssgOnInternationalOrder: '[Reply SHIPPING for more detail]'
  }  
  */

  const { topic } = parsed_body.metadata;
  const { data } = parsed_body.notification;
  
  const allowedShippingMethods = userFunctionParameter.allowed_Shipping_Methods;

  // 0) Từ EbayUserID lấy refreshToken/AccessToken từ PublicEbayAutomessage_EbayToken, check if expired, fetch Ebay lấy AccessToken mới,  ghi ngược vào Database.
  //const AccessToken = await getAccessToken(recipientUserID);
  const AccessToken = await accessTokenPromise;

  // 2) Fetch Transaction về.
  const OrderData = await getOrderData (data.order.orderId, AccessToken);   
  //console.log ("OrderData: ", JSON.stringify(OrderData, null, 2));
  const BuyerUsername = OrderData.buyer?.username; // 3) Extract username người nhận hàng từ fetch đó.

  if (!allowedShippingMethods.includes(OrderData.fulfillmentStartInstructions[0].shippingStep.shippingServiceCode))
  {
    console.log ("Shipping Method not recognized, skipping");
    return;
  };

  // 5) Gửi tin nhắn báo người dùng.
  const currentHour = new Date().getHours(); // 0-23, UTC time, so Virginia time add 4.
  let messageContent;
  messageContent = userFunctionParameter.MssgOnUsaOrder; 
  if (OrderData.program?.ebayInternationalShipping){
    messageContent = userFunctionParameter.MssgOnInternationalOrder;
  }
  //Kiểm tra Hash xem tin nhắn đã gửi chưa, idotempocy gì đấy.
  const checkHashResult = await checkHashDatabase(BuyerUsername, messageContent);
  if (!checkHashResult)
  {
    console.log ("Message already exist in hash db (so already sent then), not sending again.");
    return;
  };
  console.log ("DEBUG: Sending message to buyer, sendTextMessage input: ", OrderData.lineItems[0].legacyItemId, BuyerUsername, messageContent);
  await sendTextMessage (OrderData.lineItems[0].legacyItemId, BuyerUsername, messageContent, AccessToken);
};
async function AutoMessageReply (userFunctionParameter, parsed_body, recipientUsername, recipientUserID, accessTokenPromise)
{
  /*"notification" : 
  { // Notification 
  "notificationId" : "string",
  "eventDate" : "string",
  "publishDate" : "string",
  "publishAttemptCount" : "integer",
  "data" : 
    { // NewMessageData 
    "messageId" : "string",
    "conversationType" : "string : [FROM_MEMBERS,FROM_EBAY]",
    "conversationId" : "string",
    "messageBody" : "string",
    "senderUserName" : "string",
    "recipientUserName" : "string",
    "subject" : "string",
    "readStatus" : "boolean",
    "createdDate" : "string",
    "messageMedia" : "object[]"
    }
  }*/
  const { topic } = parsed_body.metadata;
  const { data } = parsed_body.notification;
  const messageContent = userFunctionParameter.MessageContent;
  const TriggerWord = userFunctionParameter.TriggerWord
  const conversationId = data.conversationId;
  if ((!data.messageBody) || (!TriggerWord) || (TriggerWord.toUpperCase() != data.messageBody.toUpperCase()))
  { 
    console.log ("Condition not met, returning... Debug: TriggerWord: [",TriggerWord,"], Input mesageBody: [", data.messageBody,"]"); 
    return;
  };
  //const accessToken = await getAccessToken(recipientUserID);
  const accessToken = await accessTokenPromise;
  
  const itemId = data.itemId;
  const buyerUsername = data.senderUsername;
  console.log ("Replying to user ", buyerUsername, " with conversationId id ", conversationId);
  const checkHashResult = await checkHashDatabase(buyerUsername, messageContent);
  if (!checkHashResult)
  {
    console.log ("Message already exist in hash db (so already sent then), not replying.");
    return;
  };
  await sendTextReply (conversationId, buyerUsername, messageContent, accessToken);
};
function getRecipientUsername(parsed_body) {
  const { topic } = parsed_body.metadata;
  const { data } = parsed_body.notification;

  switch (topic) {
    case 'FEEDBACK_RECEIVED':
      return data.receiverUserDetail?.userId ?? null;

    case 'ITEM_MARKED_SHIPPED':
      return data.itemMarkedShipped?.username ?? null;

    case 'ORDER_CONFIRMATION':
      return data.user?.username ?? null;

    case 'BUYER_QUESTION':
    case 'NEW_MESSAGE':
      return data.recipientUsername ?? null;

    default:
      return null;
  }
}
async function getUserIDfromUsername (recipientUsername)
{
  // From username, get userId from db
  const userInfo = await ddb.send(new GetItemCommand({
    TableName: TABLE_UserAuth,
    Key: {
      EbayUserID: { S: "username:"+recipientUsername }
    },
    AttributesToGet: ["AuthCode", "EbayUserID"]
  }));
  const recipientUserID = userInfo.Item?.AuthCode?.S;
  if (!recipientUserID) throw new Error(`User not found: ${recipientUsername}`); //How?
  return recipientUserID;
}
async function checkHashDatabase(recipientUserID, hash_input) {
  //  Summary: Check if notification is duplicate or not, return true if never seen before, return false if already seen.

  // First, get UserID from recipientUsername function input.
  // Then PUT hashed parsed_body into hashdatabase, return false if userID-hash combination already exist, return true if we put it successful (a.k.a not existed yet).
  //

  // TTL of 2 weeks I guess
  const ttl = (() => {    
    const daysBeforeDelete = 14;
    return timeInSeconds() + daysBeforeDelete * 24 * 60 * 60;
  })();

  //Generate hash from notification body data
  //const hash_input = ;
  console.log ("Hash function input: ", JSON.stringify(hash_input));
  const encoded = new TextEncoder().encode(JSON.stringify(hash_input)); //Encode string into array utf-8 bytes.
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded); // Byte buffer of SHA-256 encryped array.
  const hashArray = Array.from(new Uint8Array(hashBuffer)); //Create array from the buffer.
  const hashValue = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); //Map array of bytes to array of hex codes.

  console.log ("Hash value: ", hashValue);
  console.log ("recipientUserID: ", recipientUserID);
  //Put them all into db.
  try {
    await ddb.send(new PutItemCommand({
      TableName: TABLE_Notification_Hashing, 
      Item: {
        EbayUserID: { S: recipientUserID},
        NotificationHash: {S: hashValue},
        DeleteOn: { N: ttl.toString() }
      },
      ConditionExpression: "attribute_not_exists(NotificationHash)" //Only write if no hash exist yet.
    }));
    return true; //Not in db
  } 
  catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return false;  //Already in db
    }
    //Error not expected, throwing it then.
    throw err;
  }
}
async function userFunctionConfig(recipientUserID, event_topic) {
  // Buoc 2: Dua vao Ebay UserID tim trong db PublicEbayAutomessage_UserFunctionConfig de biet
  // function config cho user đó là gì, ví dụ như: autoMarkShipped, autoMessage, ..., va parameter.
  // Buoc 3: Return config va parameter config cua user do.
  const userFunctionConfigRow = await ddb.send(new QueryCommand({
    TableName: TABLE_UserConfig,
    KeyConditionExpression: 'EbayUserID = :id',
    ExpressionAttributeValues: {
      //':id': { S: recipientUserID }
      ':id': recipientUserID
    }
  }));
  const recipientUserConfigs = userFunctionConfigRow.Items;
  if (!recipientUserConfigs) //throw new Error(`UserConfig not found: ${recipientUserID}`); //How? Maybe if they register for topic but haven't configure their config yet.
      console.log ("Hmmm userconfigs not found, maybe user only registered for notification and not function config yet? ", recipientUserID);
  return recipientUserConfigs;

};
export const handler = async (event) => {
  var pendingPromises = [];
  console.log("full event: ", JSON.stringify(event, null, 2));
  const parsed_body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  //console.log("parsed_body: ", parsed_body);
  const recipientUsername = getRecipientUsername(parsed_body);
  if (recipientUsername == null) {console.log ("Empty recipientUsername, probably Ebay message, returning"); return 200;};
  const recipientUserID = await getUserIDfromUsername (recipientUsername);
  let accessTokenPromise = getAccessToken(recipientUserID); //await later;

  console.log("parsed_body: ",JSON.stringify(parsed_body, null, 2));
  console.log ("recipient username: ", recipientUsername, "recipient ID: ", recipientUserID);
  
  const checkHashResult = await checkHashDatabase (recipientUserID, parsed_body.notification.data);
  //if (checkHashResult == false) {console.log ("NotificationExist in Db, skipping"); return { statusCode: 200 };};
  
  let userFunctConfigs = await userFunctionConfig(recipientUserID, parsed_body.metadata);
  if (!userFunctConfigs) return {statusCode: 200};

  for (const userFunctConfig of userFunctConfigs) {
    switch (userFunctConfig.FunctionSelector)
    {
      case "AutoMessageOnOrderItemID":
        if (parsed_body.metadata.topic == "ORDER_CONFIRMATION")
        {
          console.log ("AutoMessageOnOrderItemID triggered");
          const userFunctionParameter = JSON.parse(userFunctConfig.FunctionParameter);
          pendingPromises.push(AutoMessageOnOrderItemID (userFunctionParameter, parsed_body, recipientUsername, recipientUserID, accessTokenPromise));
        }
        break;
      case "AutoMessageOnOrderShippingMethod":
        if (parsed_body.metadata.topic == "ORDER_CONFIRMATION")
        {
          console.log ("AutoMessageOnOrderShippingMethod triggered");
          console.log ("parsed_body.notification: ",  JSON.stringify(parsed_body.notification, null, 2));
          const userFunctionParameter = JSON.parse(userFunctConfig.FunctionParameter);
          console.log ("userFunctionParameter: ",  userFunctionParameter);
          pendingPromises.push(AutoMessageOnOrderShippingMethod (userFunctionParameter, parsed_body, recipientUsername, recipientUserID, accessTokenPromise));
        }
        break;
        
      case "AutoMessageOnShippingConfirmation":
        if (parsed_body.metadata.topic == "ITEM_MARKED_SHIPPED")
        {
          console.log ("AutoMessageOnShippingConfirmation triggered");
          console.log ("userFunctConfig: ", userFunctConfig);
          const userFunctionParameter = JSON.parse(userFunctConfig.FunctionParameter);
          pendingPromises.push(AutoMessageOnShippingConfirmation (userFunctionParameter, parsed_body, recipientUsername, recipientUserID, accessTokenPromise));
        }
        break;
      case "AutoMessageReply":
        if (parsed_body.metadata.topic == "NEW_MESSAGE")
        {
          console.log ("AutoMessageReply triggered");
          console.log ("userFunctConfig: ", userFunctConfig);
          const userFunctionParameter = JSON.parse(userFunctConfig.FunctionParameter);
          pendingPromises.push(AutoMessageReply (userFunctionParameter, parsed_body, recipientUsername, recipientUserID, accessTokenPromise));
        }
        break;
    }
  };
  await Promise.all(pendingPromises);
  // Mục tiêu: Đã biết người nhận noti là ai rồi, tạo database chứa hash with primary key là userid, sort key là chính cái hash đó, ttl chắc 2 tuần đi.
  // Không cần phải đợi vào function execution, cứ filter mẹ mấy cái noti đi vì nhiều noti nó khác ID but content is the same for some reason, và nếu hàm xử lý lỗi thì có gọi lại
  // with the same input thì vẫn sẽ lỗi, nên filter luôn.
  return { statusCode: 200 };
  //if (event.httpMethod === 'GET')
};



