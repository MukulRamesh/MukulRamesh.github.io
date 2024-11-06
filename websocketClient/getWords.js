var ws;
var numChoices = 3 // need to generalize this to any number of input
let myid = null;
let chosenTask = "get3" // need to set this when multiple tasks are available

choiceList = []
for (var i = 0; i < numChoices; i++)
{
    choiceList.push(document.getElementById(i + "answers"))
}

initWebSocket().then(function (wsLocal) //sets up websocket
{
    ws = wsLocal
    ws.onmessage = ({ data }) => onReceive(data)
});

function onReceive(data)
{
    parsedJson = JSON.parse(data)

    console.log(JSON.stringify(parsedJson, null, 2))

    switch (parsedJson['code'])
    {
        case "getidresponse":
            myid = parsedJson['response'] //stored in global variable so client remembers who it is
            message = {
                'code': chosenTask,
                'id': myid
            }
            ws.send(JSON.stringify(message))
            break
        // case "checkidresponse": //this case should never be recieved except for debugging purposes.
        //     if (parsedJson['response'])
        //     {
        //         message = {
        //         'code': "getid",
        //         'task': chosenTask
        //         } // need to generalize this
        //         ws.send(JSON.stringify(message))
        //         resetAllAnswers()
        //         clearRows()
        //         resetTimer()
        //     }
        //     else
        //     {
        //         console.log("This user is currently ingame, so a new game cannot be started.")
        //     }
        //     break
        case "get3response":
            for (var i = 0; i < numChoices; i++)
            {
                choiceList[i].firstChild.innerHTML = parsedJson['response'][i]
            }
            initStartingCoord()
            popOutAllOccupations()
            break
        case "check3response":
            if (parsedJson['response'] == true)
            {
                newSolutionFound(3)
                turnGreen()
                sendGet3()
            }
            else
            {
                turnRed()
                breakStreak()
                noDrag(1000)
            }
            popOutAllOccupations()
            break
        default:
            console.log("Unknown Code: ", parsedJson['code'])
    }

}

function requestNewGame() //uses code 'getid'
{
    message = {
        'code': "getid",
        'task': chosenTask
    } // need to generalize this

    ws.send(JSON.stringify(message))
}

function sendGet3()
{
    if (myid != null)
    {
        message = {
            'code': "get3",
            'id': myid,
        }
        ws.send(JSON.stringify(message))
    }
}

function sendCheckID() //called to validate the id already recieved. Function should not be called unless debugging.
{
    if (myid != null)
    {
        message = {
            'code': "checkid",
            'id': myid,
            'task': chosenTask
        }
        ws.send(JSON.stringify(message))
    }
}

function check3Solution() //gets called from interact.js when all slots are full
{

    message = {
        'code': "check3",
        'solution': check3ComposeMessage(),
        'id': myid
    }

    ws.send(JSON.stringify(message))
}