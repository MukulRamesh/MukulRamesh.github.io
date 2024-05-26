//this module makes the implicit assumption that there is only one slot (unlike the drag modules)

document.addEventListener("keydown", keypress)

// TODO: add a way to change keybinds
firstAnswerKey = "Digit1"
secondAnswerKey = "Digit2"
thirdAnswerKey = "Digit3"



function keypress(e)
{
    switch (e.code)
    {
        case firstAnswerKey:
            answerChosen(0, answerChildren[0])
            break
        case secondAnswerKey:
            answerChosen(0, answerChildren[1])
            break
        case thirdAnswerKey:
            answerChosen(0, answerChildren[2])
            break
    }
}