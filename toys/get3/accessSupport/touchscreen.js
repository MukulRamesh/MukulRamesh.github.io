const isTouchScreen = window.matchMedia("(pointer: coarse)").matches || true

console.log("Touchscreen: ", isTouchScreen)

if (isTouchScreen)
{
    //let answerChildren = allAnswersContainer.children
    for (var i = 0; i < answerChildren.length; i++)
	{
		var answerChild = answerChildren[i];
        addClickListenerToElem(answerChild, ontouch)
	}

}

function ontouch(e)
{
    id = e.originalTarget.offsetParent.id
    if (id == "")
    {
        id = e.target.id
    }

    id = id.replace("answers", "")

    answerChosen(0, answerChildren[id])
    // console.log(e, "Touch", id)
}

function addClickListenerToElem(elem, funct)
{
    if (elem.addEventListener)
        elem.addEventListener("click", funct, false);
    else if (el.attachEvent)
        elem.attachEvent('onclick', funct);
}