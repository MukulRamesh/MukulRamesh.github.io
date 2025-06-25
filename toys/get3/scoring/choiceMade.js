function answerChosen(slotIndex, answerElem)
{
    popOutOccupation(slotIndex)
    setSlotOccupied(slotIndex, answerElem)

    if (isAllSlotsOccupied())
    {
        check3Solution()
    }
}