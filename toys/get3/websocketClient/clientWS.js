function initWebSocket()
{
	return new Promise(function (resolve, reject)
	{
		var ws = new WebSocket('wss://websocket-wordvector-5a3259379d3b.herokuapp.com/');
		// var ws = new WebSocket('ws://localhost:5150'); //for testing locally (these 2 lines are the only ones i need to change)
		ws.onopen = () =>
		{
			console.log('Connection opened!');
			resolve(ws);
		}

		ws.onmessage = ({ data }) => console.log("Unsigned Data: " + data);
		ws.onclose = function ()
		{
			ws = null;
		}

		var timeWaitSec = 5;
		setTimeout(function checkIfWebSocketFailed()
		{
			if (ws == null || ws.readyState == ws.CLOSED || ws.readyState == ws.CONNECTING)
			{
				reject("No Connection");
				console.log("No Connection")
				alert("A problem occured with the websocket connection. Try turning off HTTPS-Only mode if using Firefox.")
			}
		}, 1000 * timeWaitSec)
	});
}

function messagePromise(ws)
{
	return new Promise(function (resolve)
	{
		ws.onmessage = ({ data }) =>
		{
			resolve(data);
		}
	});
}
