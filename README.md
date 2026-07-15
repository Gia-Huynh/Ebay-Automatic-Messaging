# Ebay-Automatic-Messaging
Publicized code version of my [Ebay auto messaging tool](https://ebay-pulic-message.thietgia.com/), meant to be inspect for any security flaw, but use it however you want.

**NotificationSubscription-Worker.mjs** is the worker function to handle incoming Ebay notification, it reads the user configuration from AWS DynamoDB and execute as per user input, I upload it here cuz I dunno anything about injecting malicious code into Json config.    
**HandleNewAccount.mjs** is the code to handle user registration, it receive the authorization code from client side, and consume (while still storing that authorization code) to get AccessToken/RefreshToken, and it waits for user to send their username/password creation form that should includes the Authorization code to verify if it's the right user.

## Advertisement for the site

Simple Automatic Messaging Tool for Ebay seller, current supported features:

- Auto Message based on order's Shipping method.  
  > Useful if you need to remind customer if order's shipping choice is weird (like USPS Letter not having tracking).

- Auto Message on order getting marked as **"Shipped"**.  
  > Useful if you need a few days before actually handling item over to carrier, or order not having tracking like using USPS Letter.

- Auto Message on order's specific Listing ID.  
  > For example: If order has item `XXX`, auto message `YYY`. I use it to send item specific user manual.

- Auto Message reply on trigger word.  
  > For example: "Reply **TRACKING** to know more" and auto send a message if customer actually reply **TRACKING**, so if you get creative you can create a chatbot for it lol.

---

This used to be a personal tool, but I have decided to public it with SaaS modeling (a.k.a begging for donation).

I still use it for my business so rest assured it will always be maintained, but I may take it down if it hurts my wallet badly, so no guarantee of anything, set a recurring donation if you want it to last („• ᴗ •„).

---

![Screenshot of my tool working as expected, showing a conversation going.](https://github.com/Gia-Huynh/Ebay-Automatic-Messaging/blob/main/FrontPage%20Image.PNG)

**Screenshot of my tool working as expected.**

1. First message auto send on order with USPS Letter method.
2. Second message auto send after customer reply **"TRACKING"**.
3. Third message auto send after I mark the order as **Shipped** to remind customer of expected wait time.
