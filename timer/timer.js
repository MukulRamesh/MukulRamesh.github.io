let timerElem = document.getElementById("timer")
let historyElem = document.getElementById("previousSolutionsTable")
let allAnswersContainer = document.getElementById("allAnswersContainer")

let slotContainer = document.getElementById("slotParent")
let slotChildren = slotContainer.children

function dateToTime(d)
{
    let date = new Date(d)
    let output = ""
    minutes = date.getMinutes().toString().padStart(2, '0')
    seconds = date.getSeconds().toString().padStart(2, '0')

    output = minutes + ":" + seconds

    if (date.getTime() < 10000) //add more digits once there is less than 10 seconds (10,000 ms) left
    {
        milliseconds = date.getMilliseconds().toString().padStart(2, '3')
        output += "." + milliseconds
    }

    return (output)
}

function resetTimer() //should only be called after the timer is not running (b/c of race condition). returns false if called before timer runs out
{
    if (timeLeft <= 0)
    {
        startTime = Date.now()
        timeLeft = new Date(numSeconds * 1000);
        setTimeout(step, frameTime);
        return true
    }
    else return false
}

let numSeconds = 60
var frameTime = 50; // ms
var startTime = Date.now() //set again when resetTimer is called
var expected = startTime + frameTime;
let timeLeft = null;

function step()
{
    var drift = Date.now() - expected; // the drift (positive for overshooting)
    if (drift > frameTime) {
        console.log("Timer not updating quickly; tab might be inactive")
    }

    timeLeft = (numSeconds * 1000) - (Date.now() - startTime)
    timerElem.innerHTML = dateToTime(timeLeft)

    expected += frameTime;

    if (timeLeft > 0)
    {
        setTimeout(step, Math.max(0, frameTime - drift)); // take into account drift
    }
    else
    {
        timerElem.innerHTML = "Time's up!"
        hideAnswersShowHistory()
    }
}


function hideAnswersShowHistory()
{
    historyElem.style.display = "table" //remove the 'display: none;'
    allAnswersContainer.style.display = "none"
    showRestartGame()

    //TODO: make the score and streak move to the center

}

function showRestartGame() //this is run at the very start, and is undone when clicked. when the timer runs out, this is run again.
{
    slotChildren[0].textContent = "Click to Play!"
}

function hideRestartGame() //this function is called in buttonLogic when this is clicked.
{
    slotChildren[0].textContent = ""
}