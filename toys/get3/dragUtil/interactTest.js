// let slotContainer = document.getElementById("slotParent") //defined in timer
// let slotChildren = slotContainer.children

//maybe only do bounding box math if we are going to need drag util (and we dont, if we are using a touch screen)?
if (!isTouchScreen)
{
	let snapTargets = []

	for (var i = 0; i < slotChildren.length; i++)
	{
		var slot = slotChildren[i];

		if (slot.className == 'slotBreak')
		{
			continue
		}

		var rect = slot.getBoundingClientRect()
		snapTargets.push({ x: ((rect.left + rect.right) / 2) + window.scrollX, y: ((rect.top + rect.bottom) / 2) + window.scrollY, range: 150 })
	}

	for (var i = 0; i < answerChildren.length; i++)
	{
		var answerChild = answerChildren[i];
		var rect = answerChild.getBoundingClientRect()
		snapTargets.push({ x: ((rect.left + rect.right) / 2) + window.scrollX, y: ((rect.top + rect.bottom) / 2) + window.scrollY, range: 75 })
	}

	const snapToSlot = interact.modifiers.snap({
		origin: { x: 0, y: 0 },
		endOnly: true,
		targets: snapTargets,
	})

	const answers = interact('.answers')
	answers.draggable({
		origin: 'self',
		inertia: true,                    // start inertial movement if thrown
		modifiers: [snapToSlot],
		listeners: {
			start(event)
			{
				const elem = event.target
				elem.style.position = 'absolute';
				document.onmousemove = prevent
				// console.log(event)
			},
			move(event)
			{
				const elem = event.target

				elementDrag(event, elem)

				if (!checkVisible(elem))
				{
					resetAnswer(elem)
				}

				if (event.dragLeave != null)
				{
					let slotID = event.dragLeave.id
					let index = slotID.slice(4)
					let occupation = getSlotOccupations()[index]

					if (occupation != null && occupation.id == event.target.id)
					{
						setSlotEmpty(event.dragLeave.id.slice(4))
					}

				}
			}
		},

	})


	const answerSlot = interact('.answerSlot')
	answerSlot.dropzone({
		ondrop: function (event)
		{
			// console.log(event)
			// alert(event.relatedTarget.id
			// 	+ ' was dropped into '
			// 	+ event.target.id)

			let index = event.target.id.slice(4) //magic string is the index of the slot

			answerChosen(index, event.relatedTarget)
		}
	})
		.on('dropactivate', function (event)
		{
			event.target.classList.add('drop-activated')
		})
}


function resetAnswer(elem)
{
	elem.style.top = elem.getAttribute("startingStyleY") + "px"
	elem.style.left = elem.getAttribute("startingStyleX") + "px"
}

function popOutOccupation(index) //pops out the answer if it is currently in a slot
{
	if (isSlotOccupied(index))
	{
		let occupation = getSlotOccupations()[index]
		resetAnswer(occupation)
	}
}

function resetAllAnswers()
{
	for (var i = 0; i < answerChildren.length; i++)
	{
		answerChild = answerChildren[i].firstChild
		resetAnswer(answerChild)
		setSlotEmpty(i)
	}

	// answers.reflow({ name: 'drag', axis: 'xy' })
}

function popOutAllOccupations() //also sets slots as empty.
{
	for (var i = 0; i < getNumSlots(); i++)
	{
		popOutOccupation(i)
		setSlotEmpty(i)
	}

	// answers.reflow({ name: 'drag', axis: 'xy' })

}


function prevent(e)
{
	e.preventDefault();
}

flag = true
function noDrag(time)
{
  flag = false
  setTimeout(yesDrag, time)
}

function yesDrag()
{
  flag = true
}

function elementDrag(event, elem)
{
	if (flag)
	{
		const position = { pos1: 0, pos2: 0, pos3: (elem.clientWidth + elem.clientLeft) / 2, pos4: (elem.clientHeight + elem.clientTop) / 2 }

		position.pos1 = position.pos3 - event.clientX;
		position.pos2 = position.pos4 - event.clientY;
		position.pos3 = event.clientX;
		position.pos4 = event.clientY;
		// set the element's new position:
		elem.style.top = (elem.offsetTop - position.pos2) + "px";
		elem.style.left = (elem.offsetLeft - position.pos1) + "px";
	}
}

function checkVisible(elm)
{
	var rect = elm.getBoundingClientRect();
	var viewHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
	var viewWidth = Math.max(document.documentElement.clientWidth, window.innerWidth);
	return !(rect.bottom < 0 || rect.top - viewHeight >= 0 || rect.left < 0 || rect.right - viewWidth >= 0);
}