//this module implicitly assumes that there is only one slot (unlike the drag module for example)


showRestartGame()
addClickListenerToElem(slotChildren[0], resetGame)


// addClickListenerToElem(positionResetButton, resetAllAnswers)
// addClickListenerToElem(getNewWordsButton, sendGet3)
// addClickListenerToElem(resetGameButton, sendCheckID)

function resetGame()
{
    if (resetTimer())
    {
        requestNewGame()
        hideRestartGame()
        hideHistoryShowAnswers()
        clearScore()
        clearHistory()
    }
}

function hideHistoryShowAnswers()
{
    historyElem.style.display = "none" //remove the 'display: none;'
    allAnswersContainer.style.display = "flex"
}

// function addClickListenerToElem(elem, funct) // this function is defined in accessSupport/touchscreen.js
// {
//     if (elem.addEventListener)
//         elem.addEventListener("click", funct, false);
//     else if (elem.attachEvent)
//         elem.attachEvent('onclick', funct);
// }
