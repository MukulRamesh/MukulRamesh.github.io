// let historyElem = document.getElementById("previousSolutionsTable") //already defined in timer
let numTableRows = 1

function newSolutionFound(numSlots)
{
    increaseScore()
    increaseStreak()
    if (numSlots == 3) // TODO: generalize to any number of slots
    {
        let solution = check3ComposeMessage()
        addRowPrevAnsw(solution[0], solution[2], solution[1])
    }
}

function addRowPrevAnsw(right, avr, left) //TODO: generalize to any number of inputs (taken as list)
{
    let row = historyElem.insertRow(-1)
    row.insertCell(0).innerHTML = right
    row.insertCell(1).innerHTML = avr
    row.insertCell(2).innerHTML = left
    numTableRows++
}

function clearHistory() //reset table for new game
{
    for (let i = 1; i < numTableRows; i++)
    {
        historyElem.deleteRow(1)
    }
    numTableRows = 1
}