//import axios from "axios";
//import qs from "querystring";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, TransactWriteCommand} from "@aws-sdk/lib-dynamodb";
import jwt from 'jsonwebtoken';
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const allowedOrigins = new Set([
  "http://localhost:8000",
  "https://awssignuppage.com"
]);

async function ConsumeAuthorizationCode (event)
{
  const authCode = event.queryStringParameters.code;
  const state = JSON.parse(
                  decodeURIComponent(event.queryStringParameters.state)
                );

  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const redirectUri = process.env.REDIRECT_URI;
  //const redirectUri = "https://dctbqc5zd0.execute-api.us-east-1.amazonaws.com/default/EbayPublicAutoMessage_HandleNewAccount";
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const decoded_code = decodeURIComponent (authCode);
  const response = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${auth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code", //Set grant_type to authorization_code., as per Ebay
        code: decoded_code,
        redirect_uri: redirectUri,
      }),
    }
  );
  const data = await response.json();
  console.log ("Fetch Token Data: ", data);
  //data.access_token, data.refresh_token
  const userResponse = await fetch(
    "https://apiz.ebay.com/commerce/identity/v1/user/",
    {
      headers: {
        Authorization: `Bearer ${data.access_token}`
      }
    }
  );
  const userData = await userResponse.json();
  console.log ("userData:", userData);
  const EbayUserID = userData.userId; //also exist userData.username

  const redirect_url = state.redirect_url;
  const tempUrl = new URL(redirect_url);
  if (!allowedOrigins.has(tempUrl.origin))
  {
    return {
      statusCode: 400,
      body: "Invalid signup_url"
    };
  }

  //Upsert to database, AuthCode will be used to recheck later on to verify the real user.
  await Promise.all([ docClient.send(new PutCommand({
    TableName: "PublicEbayAutomessage_EbayToken",
    Item: {
      "EbayUserID": EbayUserID,
      "AuthCode": authCode,
      "AccessToken": data.access_token,
      "RefreshToken": data.refresh_token,
      "UpdatedAt": Date.now()
    }
  })),
  //Upsert a binding between Ebay username and EbayID
  docClient.send(new PutCommand({
    TableName: "PublicEbayAutomessage_EbayToken",
    Item: {
      "EbayUserID": "username:"+userData.username,
      "AuthCode": EbayUserID,
      "UpdatedAt": Date.now()
    }
  }))]);


  tempUrl.searchParams.set("authCode", authCode);
  tempUrl.searchParams.set("EbayUserId", EbayUserID);
  return {
    statusCode: 302,
    headers: {
      Location: tempUrl.toString()
    }
  };
}
async function RegisterOrCheckUser (event)
{
  console.log ("RegisterOrCheckUser: ", event);
  const body = JSON.parse(event.body);
  console.log ("RegisterOrCheckUser body: ", body);
  const username = body.username;
  const password = body.password;
  const EbayUserID = body.ebayUserID;
  const authCode = body.authCode;
  if ((EbayUserID == null) && (authCode == null)){ //Both don't exist so user is loging in.
    const { Item } = await docClient.send(
      new GetCommand({
        TableName: "PublicEbayAutomessage_UserAuth",
        Key: {
          username
        }
      })
    ); //"", Item: { username: username, password: password, EbayUserID: EbayUserID, UpdatedAt: Date.now()}}},
    if (Item == null)
    {
      return {
          statusCode: 401,
          body: JSON.stringify({ error: "Username don't exist buddy. If you forgot about it, then go to the registration page and 'register' again to overwrite the old username/password, you won't lose any data."})
      };
    };
    if (Item.password != password) {
      return {
          statusCode: 401,
          body: JSON.stringify({ error: "Wrong password."})
      };
    };
    //Right username and password, JWT time.
    const token = jwt.sign(
      { username: Item.username, EbayUserID: Item.EbayUserID },
      process.env.JWT_SECRET,
      { expiresIn: '3d' }
    );    
    return {
      statusCode: 200,
      body: JSON.stringify({ token })
    };
  }


  else if ((EbayUserID != null) && (authCode != null)){ //Both exists so user is registering.
    console.log ("Checking database for user: ", EbayUserID);
    // Get EbayUserID Item from EbayToken db, to compare if authCode is matching or not.
    const { Item } = await docClient.send(
      new GetCommand({
        TableName: "PublicEbayAutomessage_EbayToken",
        Key: {
          EbayUserID
        }
      })
    );
    // If authCode is not matching, not the right owner of the account, or some bug happens, need to log in Ebay again to proove the right user.
    if ((Item == null) || (Item.AuthCode != authCode))
    {
      return {
          statusCode: 401,
          body: JSON.stringify({ error: "Login Ebay step 1 again luv, something fucked up on server side or client side, not sure."})
      };
    };
    if (username.startsWith("EbayUserID")) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Can't use \"EbayUserID\" in your username prefix, nigga." })
      };
    }
    //We've reached here, so AuthCode is matching, verified to be the real user.
    // Because we want to make sure that EbayUserID is unique accross all username (so we won't have two username pointing to the same EbayUserID),
    // We use Aws Pattern: GET command checking if {username:"EbayUserID"+EbayUserID} exists, 
    //    If it does, it means that there already exist an actual username pointing to the EbayUserID. The row containing it will use EbayUserID field to store the original username so we know which row to delete.
    //    If it does not, then this is a fresly new user, Putting two rows as:
    //        actual data row: {username: username, password: password,  EbayUserID: EbayUserID, UpdatedAt: Date.now()}
    //        aws pattern ensuring EbayUserID unique row: {username: "EbayUserID"+EbayUserID, EbayUserID: EbayUserID  }
    // Check if EbayUserID is already taken by another username
    const { Item: existingEbayID } = await docClient.send(
      new GetCommand({
        TableName: "PublicEbayAutomessage_UserAuth",
        Key: { username: "EbayUserID" + EbayUserID }
      })
    );

    if (existingEbayID != null) {
      await docClient.send(new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: "PublicEbayAutomessage_UserAuth", Key: { username: existingEbayID.EbayUserID } } },
          { Delete: { TableName: "PublicEbayAutomessage_UserAuth", Key: { username: "EbayUserID" + EbayUserID } } }
        ]
      }));
    }

    // Fresh user — insert both rows

    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {Put: {TableName: "PublicEbayAutomessage_UserAuth", Item: { username: username, password: password, EbayUserID: EbayUserID, UpdatedAt: Date.now()}}},
        {Put: {TableName: "PublicEbayAutomessage_UserAuth", Item: { username: "EbayUserID" + EbayUserID, EbayUserID: username }}} 
      ]
    }));

    return {
        statusCode: 200,
        body: JSON.stringify({ error: "Account and Password pair has been created (or updated)"})
    };
  }

  return {
      statusCode: 501,
      body: JSON.stringify({ error: "We are not supposed to reach this statement, email me about this (RegisterOrCheckUser)"})
  };
};
export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method === "GET") {
      return ConsumeAuthorizationCode(event);
  }
  if (method === "POST") {
      return RegisterOrCheckUser(event);
  }
  if (method === "OPTIONS") {
    return {
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        }
      };
  }
  return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed, Get and Post only." })
  };
};