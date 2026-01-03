I need to build project . Here is what i want :
I want to have telegram bot , which will receive task messages from users like : 
"Remind me to call mom at 5 PM"or 
"Set a meeting with John tomorrow at 10 AM"
or this kinda voice messages.

If the user sends a voice message, the bot should transcribe it to text first. (with AI)

Then the bot should parse the text to extract the task details (like what to do and when).

Finally, the bot should store these tasks in a database and send reminders to users at the specified times.

The task must have status (pending, completed, overdue).
When the reminder is sent, the task should have button to mark it as completed or delay it for some time.
The bot should also have commands to list all tasks, delete tasks, and update task details.

for technologies, I want to use nodejs . for telegram bot i want to use grammY library. for transcription i want to use openai. 
to get task details from text i want to use openai too. for database i want to use mongodb.

I want to use clean architecture for this project.The project structure should have clear separation between different layers.
You can see how i implemented clean architecture in one of my projects here : 
../payme/payments-transaxis-service

Based on your requirements, here's a suggested project structure and implementation plan for your Telegram bot using Node.js, grammY, OpenAI, and MongoDB, following clean architecture principles.