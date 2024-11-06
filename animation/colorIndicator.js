//these functions also show an emoji representing whether the answer was correct or not: ✅ or ❌
emojiText = document.getElementById("emojiText")

function turnGreen()
{
    turnColor('lightgreen')
    emojiText.textContent = '✅'
}

function turnRed()
{
    turnColor('tomato')
    emojiText.textContent = '❌'
}

var currentTimer = null
function turnColor(color='white') //expects only red or green
{
    if (currentTimer != null)
    {
        clearTimeout(currentTimer)
    }

    for (var i = 0; i < slotChildren.length; i++)
    {
        slotChildren[i].style.cssText = "background-color: " + color

    }

    if (color != 'white')
    {
        //the delay should be equal or greater than the time specified in 'transition: background-color [TIME] cubic-bezier(1, 1, 1, 1);' in .answerSlot for the transition to occur fully
        //it is curently 200ms
        currentTimer = setTimeout(turnColor, 1000)
    }
    else
    {
        emojiText.textContent = ''
    }
}