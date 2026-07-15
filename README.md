# Ebay-Automatic-Messaging
Publicized code version of my Ebay auto messaging tool, meant to be inspect for any security flaw, but use it however you want.

NotificationSubscription-Worker.mjs is the worker function to handle incoming Ebay notification, it reads the user configuration from AWS DynamoDB and execute as per user input, I upload it here cuz I dunno anything about injecting malicious code into Json config.
HandleNewAccount.mjs is the code to handle user registration, it receive the authorization code from client side, and consume (while still storing that authorization code) to get AccessToken/RefreshToken, and it waits for user to send their username/password creation form that should includes the Authorization code to verify if it's the right user.
