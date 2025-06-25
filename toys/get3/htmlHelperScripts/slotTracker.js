// slotContainer = document.getElementById("slotParent") //defined in timer
numSlots = 1 //when i generalize, this value needs to be set

//  slotOccupiedBy[index] = the answer elem
slotOccupiedBy = []

for (let i = 0; i < numSlots; i++) {
    slotOccupiedBy[i] = null
}

function logSlotOccupations()
{
    out = ""
    for (let i = 0; i < numSlots; i++)
    {
        if (slotOccupiedBy[i] == null)
        {
            out = out + "NULL, "
        }
        else
        {
            out = out + slotOccupiedBy[i].innerHTML + ", "
        }
    }
    console.log(out)
}

function setSlotEmpty(slotIndex) //this breaks if the word is too big (because the hitbax is too big) TODO: Fix slot hitbox issues
{
    slotOccupiedBy[slotIndex] = null
    // logSlotOccupations()
}

function setSlotOccupied(slotIndex, item)
{
    slotOccupiedBy[slotIndex] = item
    // logSlotOccupations()
}

function getSlotOccupations()
{
    return slotOccupiedBy
}

function getStringSlotOccupations()
{
    wordSolutions = []

    for (var i = 0; i < slotOccupiedBy.length; i++)
    {
        wordSolutions.push(slotOccupiedBy[i].firstChild.textContent)
    }

    return wordSolutions
}

function getNumSlots()
{
    return numSlots
}

function isSlotOccupied(slotIndex)
{
    return (slotOccupiedBy[slotIndex] != null)
}

function isAllSlotsOccupied()
{
    for (let i = 0; i < numSlots; i++) {
        if (slotOccupiedBy[i] == null)
        {
            return false
        }
    }
    return true
}