$(function() {
	//initialize canvas, one for image and another for drawing paths
	var canvas = document.getElementById('myCanvas');
	var canvas2 = document.getElementById('myCanvas2');
	var canvaswidth = canvas.width;
	var canvasheight = canvas.height;
	var imagewidth = canvas.width;
	var imageheight = canvas.height;
	var ctx = canvas.getContext('2d');
	var ctx2 = canvas2.getContext('2d');
	
	//some global constants
	var max_val = Number.MAX_VALUE;
	
	//for loading images
	var loader = document.getElementById("uploadimage");
	var orig_img_data = null;
	
	//for calculating path costs
	var path_cost_array = [];
	var lap_cost_array = [];
	var grad_cost_array = [];
	var lap_mask= [];
	
	//store user input to drawpaths
	var index_arr = [];
	var seed_src = 0;
	var dest_src = 0;
	var disable_click = true;
	
	//for drawing in canvas
	var clickX = new Array();
	var clickY = new Array();
	var clickDrag = new Array();
	var clicks = new Array();
	var paint = 0;
	
	//max min function for array
	Array.prototype.max = function() {
		return Math.max.apply(null, this);
	};
	Array.prototype.min = function() {
		return Math.min.apply(null, this);
	};
	
	//get cursor coordinates function
	function getCursorPosition(canvas, event) {
		var rect = canvas.getBoundingClientRect();
		var x = Math.round(event.clientX - rect.left);
		var y = Math.round(event.clientY - rect.top);
		return (x+y*canvaswidth);
	}
	//reader function
	function readImage(file) {
		var reader = new FileReader();
		reader.addEventListener("load", function() {
			var image = new Image();
			var f = document.getElementById("uploadimage").files[0];
			var url = window.URL || window.webkitURL;
			var src = url.createObjectURL(f);

			useBlob = false && window.URL;
			image.addEventListener("load", function() {
				if (useBlob) {
					window.URL.revokeObjectURL(image.src);
				}
			});
			image.src = useBlob ? window.URL.createObjectURL(file) : reader.result;
			image.src = src;
			image.onload = function() {
				//expand canvas sizes according to image
				canvas.width = image.width;
				canvas.height = image.height;
				canvas2.width = image.width;
				canvas2.height = image.height;
				canvaswidth = canvas.width;
				canvasheight = canvas.height;
				
				//clear and draw images
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx2.clearRect(0, 0, canvas.width, canvas.height);
				ctx.drawImage(image, 0, 0);
				//store pixel information
				orig_img_data = ctx.getImageData(0, 0, canvas.width, canvas.height);
				//creating cost function of the image for each pixels
				path_cost_array = calc_cost();
				url.revokeObjectURL(src);
			};
		});
		//varibles to store the user input
		clickX = new Array();
		clickY = new Array();
		clickDrag = new Array();
		clicks = new Array();
		paint = 0;
		reader.readAsDataURL(file);
	}

	//filter that takes kernel and convolutes over whole image
	convolute = function(imageData, weights, change_canvas, transparent) {
		var side = Math.round(Math.sqrt(weights.length));
		var halfSide = Math.floor(side / 2);
			
		// change canvas updates the image in the canvas
		var src = imageData.data;
		var sw = imageData.width;
		var sh = imageData.height;
		// pad output by the convolution matrix
		var w = sw;
		var h = sh;
		//to store output image data
		var output = ctx.createImageData(w, h);
		var dst = output.data;
		//image as represented in Unsigned int, to store negative values neg_op is used
		var neg_op = Array(w*h*4).fill(0);
		
		alphaFac = transparent ? 0:1;
		// go through the destination image imageData
		for (var y = 0; y < h; y++) {
			for (var x = 0; x < w; x++) {
				var sy = y;
				var sx = x;
				var dstOff = (y * w + x) * 4;
				// calculate the weighed sum of the source image imageData that
				// fall under the convolution matrix
				var r = 0,
				    g = 0,
				    b = 0,
				    a = 0;
				for (var cy = 0; cy < side; cy++) {
					for (var cx = 0; cx < side; cx++) {
						var scy = sy + cy - halfSide;
						var scx = sx + cx - halfSide;
						if (scy >= 0 && scy < sh && scx >= 0 && scx < sw) {
							var srcOff = (scy * sw + scx) * 4;
							var wt = weights[cy * side + cx];
							r += src[srcOff] * wt;
							g += src[srcOff + 1] * wt;
							b += src[srcOff + 2] * wt;
							a += src[srcOff + 3] * wt;
						}
					}
				}
				dst[dstOff] = r;
				dst[dstOff + 1] = g;
				dst[dstOff + 2] = b;
				dst[dstOff + 3] = a + alphaFac*(255-a);
				
				neg_op[dstOff] = r;
				neg_op[dstOff + 1] = g;
				neg_op[dstOff + 2] = b;
				neg_op[dstOff + 3] = a + alphaFac*(255-a);
			}
		}
		if(change_canvas){
			ctx.putImageData(output, 0, 0);
		}
		return [output,neg_op];
	};
	
	//cost calculation function
	function calc_cost(){
		var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		var data = imageData.data;
		
		var iw =imageData.width;
		var ih =imageData.height;
		imagewidth = iw;
		imageheight = ih;
		
		var filtered_data = imageData;
		
		var output = ctx.createImageData(iw, ih);
		var dst = output.data;
		
		//used to smooth the data before processing
		// var gaussian_blur_x_5 = [2,4,5,4,2,     4,9,12,9,4,       5,12,15,12,5,     4,9,12,9,4,       2,4,5,4,2].map(function(x) { return x /159; });
		// filtered_data = convolute( imageData, gaussian_blur_x_5)[0];
		
		//laplacian kernels
		/** computing laplacian */
		var lap_1 = [0,-1,0, -1,4,-1, 0,-1,0];//sharp edge
		var lap_2 = [-1,-1,-1, -1,8,-1, -1,-1,-1];//thick edge
		var lap_3 = [1,-2,1, -1,4,-1, 1,-2,1];//sharpen
		
		var lp_datas = convolute( filtered_data, lap_1 );
		var lp_data = lp_datas[1];
		lap_mask = lp_datas[0];
		//calculating laplacian zero crossings
		for (var i = 0; i < data.length-1; i++) {
			if(lp_data[i]*lp_data[i+1]<0){
				if(Math.abs(lp_data[i])<Math.abs(lp_data[i+1])){
					lp_data[i] = 0;
				} else{
					lp_data[i] = 1;
				}
			} else{
				lp_data[i] = 1;
			}
		}
		/** computing sobel X and Y */
		var sobel_x = [-1,0,1, -2,0,2, -1,0,1];
		var gx_data = convolute( filtered_data, sobel_x )[1];
		
		var sobel_y = [-1,-2,-1, 0,0,0, 1,2,1];
		var gy_data = convolute( filtered_data, sobel_y )[1];
		
		
		var l_cost_array = Array(data.length).fill(0);
		var g_cost_array = Array(data.length).fill(0);
		var gd_cost_array = Array(data.length).fill(0);
		
		//weights
		var wl = 0.43;//laplacian weight
		var wd = 0.43;//gradient direction weight
		var wg = 0.43;//sobel gradient weight
		// var wl = 0.43;
		// var wd = 0;
		// var wg = 0.4;
		var max_g = 0;//max gradient from sobel
		
		//computing gradient cost
		for (var i = 0; i < data.length; i++) {
			var gx_sq = Math.pow(gx_data[i],2);
			var gy_sq = Math.pow(gy_data[i],2);
			var g = 	Math.sqrt(gx_sq + gy_sq);
			var theta = gx_sq==0?Math.PI/2:Math.atan(gy_data[i]/gx_data[i]);
			g_cost_array[i]     =  g;
			gd_cost_array[i]    = theta;
		}
		//gradient and laplacian cost for each pixel
		var fl_cost_array = Array(iw*ih).fill(1);
		var fg_cost_array = Array(iw*ih).fill(0);
		var new_gx_data = [];
		var new_gy_data = [];
		for (var i = 0; i < data.length; i+=4) {
			var new_pt = Math.floor(i/4);
			if(lp_data[i]==0||lp_data[i+1]==0||lp_data[i+2]==0){
				fl_cost_array[new_pt] = 0;
			}
			fg_cost_array[new_pt] = Math.sqrt( (Math.pow(g_cost_array[i],2)+Math.pow(g_cost_array[i+1],2)+Math.pow(g_cost_array[i+2],2))/3);
			new_gx_data.push( (gx_data[i]+gx_data[i+1]+gx_data[i+2]+gx_data[i+3])/4 );
			new_gy_data.push( (gy_data[i]+gy_data[i+1]+gy_data[i+2]+gy_data[i+3])/4 );
			//computing max value of gradient
			if(fg_cost_array[new_pt]>max_g){
				max_g = fg_cost_array[new_pt];
			}
			//fill index
			index_arr.push(i/4);
		}
		//normalizing gradient
		var new_length = iw*ih;
		for (var i = 0; i < new_length; i++) {
			fg_cost_array[i]     =  1 - (fg_cost_array[i]/max_g);
		}
		//final gradcost
		lap_cost_array = fl_cost_array;
		grad_cost_array = fg_cost_array;
		// cost
		var cost_array = Array(iw*ih).fill(Array(8).fill(0));
		var totalcost_arr = [];
		//some constants
		var isqrt_2 = 1/Math.sqrt(2);
		var const_1 = 2/(3*Math.PI);
		for (var j = 0; j < ih; j++){
			for (var i = 0; i < iw; i++){
				
				var old_point = j*iw + i;
				
				var y_up = (j==ih-1)?ih-1:j+1;
				var y_down = (j==0)?j:j-1;
				var x_up = (i==iw-1)?iw-1:i+1;
				var x_down = (i==0)?i:i-1;
				
				//direction of pixels, 0->left,1->top-left, 2->top and so on
				var n_0 = j*iw + (x_up);
				var n_1 = (y_down)*iw + (x_up);
				var n_2 = (y_down)*iw + i;
				var n_3 = (y_down)*iw + (x_down);
				var n_4 = j*iw + (x_down);
				var n_5 = (y_up)*iw + (x_down);
				var n_6 = (y_up)*iw + i;
				var n_7 = (y_up)*iw + (x_up);
				
				//distance between pixel and its neighbour
				var lpq_0 = 1;
				var lpq_1 = isqrt_2;
				var lpq_2 = 1;
				var lpq_3 = isqrt_2;
				var lpq_4 = 1;
				var lpq_5 = isqrt_2;
				var lpq_6 = 1;
				var lpq_7 = isqrt_2;

				//cost for each neighbouring pixel
				var cost = 0;
				cost = wl*Math.abs(fl_cost_array[old_point]-fl_cost_array[n_0]) + wg*Math.abs(fg_cost_array[old_point]-fg_cost_array[n_0]);
				if(i>=iw-1){
					cost =max_val;
				}
				totalcost_arr.push(cost);
				
				cost = wl*Math.abs(fl_cost_array[old_point]-fl_cost_array[n_1]) + wg*Math.abs(fg_cost_array[old_point]-fg_cost_array[n_1]);
				if(i>=iw-1||j==0){
					cost =max_val;
				}
				totalcost_arr.push(cost);
				
				cost = wl*Math.abs(fl_cost_array[old_point]-fl_cost_array[n_2]) + wg*Math.abs(fg_cost_array[old_point]-fg_cost_array[n_2]);
				if(j==0){
					cost =max_val;
				}
				totalcost_arr.push(cost);
				
				cost = wl*Math.abs(fl_cost_array[old_point]-fl_cost_array[n_3]) + wg*Math.abs(fg_cost_array[old_point]-fg_cost_array[n_3]);
				if(j==0||i==0){
					cost =max_val;
				}
				totalcost_arr.push(cost);
				
				cost = wl*Math.abs(fl_cost_array[old_point]-fl_cost_array[n_4]) + wg*Math.abs(fg_cost_array[old_point]-fg_cost_array[n_4]);
				if(i==0){
					cost =max_val;
				}
				totalcost_arr.push(cost);
				
				cost = wl*Math.abs(fl_cost_array[old_point]-fl_cost_array[n_5]) + wg*Math.abs(fg_cost_array[old_point]-fg_cost_array[n_5]);
				if(j>=ih-1||i==0){
					cost =max_val;
				}
				totalcost_arr.push(cost);
				
				cost = wl*Math.abs(fl_cost_array[old_point]-fl_cost_array[n_6]) + wg*Math.abs(fg_cost_array[old_point]-fg_cost_array[n_6]);
				if(j>=ih-1){
					cost =max_val;
				}
				totalcost_arr.push(cost);
				
				cost = wl*Math.abs(fl_cost_array[old_point]-fl_cost_array[n_7]) + wg*Math.abs(fg_cost_array[old_point]-fg_cost_array[n_7]);
				if(j>=ih-1||i>=iw-1){
					cost =max_val;
				}
				totalcost_arr.push(cost);
			}
		}
		// console.log(orig_img_data);
		// console.log(lap_mask);
		return totalcost_arr;
	}
	//used to trace the path
	function find_parent(arr, dest_idx, src_idx){
		var i = 0;
		var cur_idx = dest_idx;
		var path_arr = [dest_idx];
		while(cur_idx != src_idx){
			i++;
			if(i>50){
				console.log('no par');
				break;
			}
			cur_idx = arr[cur_idx];
			path_arr.push(cur_idx);
		}
		return path_arr;
	}
	
	//event listeners
	loader.addEventListener("change", function() {
		var files = this.files;
		var errors = "";
		if (!files) {
			errors += "File upload not supported by your browser.";
		}
		if (files && files[0]) {
			for (var i = 0; i < files.length; i++) {
				var file = files[i];
				if ((/\.(png|jpeg|jpg)$/i).test(file.name)) {
					readImage(file);
				} else {
					errors += file.name + " Unsupported Image extension\n";
				}
			}
		}
		if (errors) {
			alert(errors);
		}
	});
	
	$('#restore-btn').click(function(){
		ctx.putImageData(orig_img_data, 0, 0);
	});
	
	$('#filter-btn').click(function() {
		// grayscale();
		var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		var lap_1 = [0,-1,0, -1,4,-1, 0,-1,0];//sharp edge
		var lap_2 = [-1,-1,-1, -1,8,-1, -1,-1,-1];//thick edge
		var lap_3 = [1,-2,1, -1,4,-1, 1,-2,1];//sharpen
		
		var gaussian_blur_x_5 = [2,4,5,4,2,     4,9,12,9,4,       5,12,15,12,5,     4,9,12,9,4,       2,4,5,4,2].map(function(x) { return x /159; });
		var gaussian_blur_x_3 = [1,2,1,     2,4,2,      1,2,1].map(function(x) { return x /16; });
		var sobel_x = [-1,0,1, -2,0,2, -1,0,1];
		// var sobel_x = [-4,0,1, -5,0,2, -1,0,1];
		var sobel_y = [-1,-2,-1, 0,0,0, 1,2,1];
		
		// convolute( gaussian_blur_x_5);
		var new_data =convolute( imageData, lap_1, true)[0];
		// console.log(new_data);
		// convoluteSobel( sobel_y );
	});
	
	$('#seed-btn').click(function myFunction() {
	});
	$('#dest-btn').click(function(evt) {
	});
	
	//mouse functions
	function getMousePos(canvas, evt) {
		var rect = canvas2.getBoundingClientRect();
		return {
			x : evt.clientX - rect.left,
			y : evt.clientY - rect.top
		};
	}
	
	//for drawing outline in canvas
	$('#myCanvas2').mousedown(function(e) {
		var mousePos = getMousePos(canvas, e);
		addClick(mousePos.x, mousePos.y);
		clicks = remove_redundant(clicks);
		if(paint==0){
			seed_src = parseInt(mousePos.y*canvaswidth+(mousePos.x));
			console.log(seed_src);
		}
		paint++;
		redraw(e);
	});
	
	$('#myCanvas2').mousemove(function(e) {
		if (paint) {
			paint++;
			var mousePos = getMousePos(canvas, e);
			addClick(mousePos.x, mousePos.y, true);
			clicks = remove_redundant(clicks);
			redraw(e);
			dest_src = parseInt(mousePos.y*canvaswidth+(mousePos.x));
			draw_path(path_cost_array, seed_src, dest_src, canvaswidth, canvasheight);
		}
	});
	
	$('#myCanvas2').mouseup(function(e) {
		paint = 0;
	});
	
	$('#myCanvas2').mouseleave(function(e) {
		paint = 0;
	});
	//storing click information from user
	function addClick(x, y, dragging) {
		clickX.push(x);
		clickY.push(y);
		for(var j=-10; j<10;j++){
			if((y+j)>0&&(y+j)<imageheight){
				for(var i=-10; i<10;i++){
					if((x+i)>0&&(x+i)<imagewidth){
						clicks.push(parseInt((y+j)*imagewidth+(x+i)));
					}
				}
			}
		}
		clickDrag.push(dragging);
	}
	
	//removing duplicate elements, pixels clicked by user
	function remove_redundant(arr) {
		// var seen = {};
		// var out = [];
		// var len = arr.length;
		// var j = 0;
		// for(var i = 0; i < len; i++) {
			// var item = arr[i];
			// if(seen[item] !== 1) {
				// seen[item] = 1;
				// out[j++] = item;
			// }
		// }
		// return out;
		if (arr.length === 0) return arr;
			arr = arr.sort(function (a, b) { return a*1 - b*1; });
			var ret = [arr[0]];
			for (var i = 1; i < arr.length; i++) { // start loop at 1 as element 0 can never be a duplicate
				if (arr[i-1] !== arr[i]) {
					ret.push(arr[i]);
			}
		}
		return ret;
	}
	/* used to paint on canvas, canvas is not cleared but its state is saved everytime function is called */
	function redraw(e) {
		ctx2.strokeStyle = "rgba(255, 0, 0, 1)";
		ctx2.lineJoin = "round";
		ctx2.lineWidth = 20;
		var mousePos = getMousePos(canvas, e);
		ctx2.beginPath();
		if (paint > 1) {
			// 2*clickX[n-1] - clickX[n-2] is used to draw line of correct length while dragging
			ctx2.moveTo(2 * clickX[clickX.length - 1] - clickX[clickX.length - 2], 2 * clickY[clickY.length - 1] - clickY[clickY.length - 2]);
		} else {
			//used to draw dot
			ctx2.moveTo(clickX[clickX.length - 1] - 1, clickY[clickY.length - 1] - 1);
		}
		// line drawn to current mouse position
		ctx2.lineTo(mousePos.x, mousePos.y);
		ctx2.closePath();
		ctx2.stroke();
		ctx2.save();
	}
	//function used to check laplacian and draw the outline
	//its not complete yet
	function draw_path(orig_costarr, orig_source, dest, iw, iw){
		var costarr = [];
		var source = orig_source;
		
		var src_idx = 0;
		var dest_idx = 0;
		var prev_data = clicks[0];
		
		var output = orig_img_data;
		dst = output.data;
		//extract points in clicks only
		for(var i=0; i<clicks.length; i++){
			if((lap_mask.data[clicks[i]*4]+lap_mask.data[clicks[i]*4+1]+lap_mask.data[clicks[i]*4]+2)>100){
				dst[clicks[i]*4] = 0;
				dst[clicks[i]*4+1] = 255;
				dst[clicks[i]*4+2] = 0;
				dst[clicks[i]*4+3] = 255;
			}
		}
		console.log(orig_img_data.data);
		console.log(lap_mask.data);
		ctx.putImageData(output, 0, 0);
	}
});
