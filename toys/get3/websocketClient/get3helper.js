function check3ComposeMessage()
{
    average = getStringSlotOccupations()[0] //since this is check3, we only care about (only) one elem.
    output = []
    for (let i = 0; i < answerChildren.length; i++)
    {
        let answertext = answerChildren[i].firstChild.textContent

        if (average != answertext)
        {
            output.push(answertext)
        }
    }

    output.push(average)

    return output
}
